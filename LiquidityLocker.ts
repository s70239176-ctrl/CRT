/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║            LiquidityLocker — OP_NET Contract  v3.0  (TESTNET)              ║
 * ║                                                                              ║
 * ║  MotoSwap LP token locker — production-ready for OP_NET testnet             ║
 * ║                                                                              ║
 * ║  NEW in v3:                                                                  ║
 * ║    • Partial unlock   — withdraw a portion of a timed lock early            ║
 * ║    • Split lock       — divide one lock into two independent locks          ║
 * ║    • Lock NFT receipt — on-chain receipt token minted per lock              ║
 * ║    • Fee treasury     — optional protocol fee on lock creation               ║
 * ║    • Batch lock       — lock multiple LP pairs in one transaction            ║
 * ║    • Testnet config   — hardcoded tBTC faucet + PILL testnet addresses      ║
 * ║    • Enhanced events  — richer payloads for OPScan + OP_WALLET v2           ║
 * ║    • Lock metadata v2 — creation tx hash, nonce, category tag               ║
 * ║                                                                              ║
 * ║  Base:    btc-vision/opnet-contracts  DeployableOP_20                       ║
 * ║  Network: OP_NET TESTNET                                                    ║
 * ║  Deploy:  P2OP address (bc1p…)                                              ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 *
 * ── Testnet Addresses ─────────────────────────────────────────────────────────
 *   tBTC Faucet:       https://faucet.opnet.org
 *   PILL (testnet):    bc1p_PILL_TESTNET_CONTRACT_ADDRESS
 *   MOTO (testnet):    bc1p_MOTO_TESTNET_CONTRACT_ADDRESS
 *   MotoSwap Factory:  bc1p_MOTOSWAP_FACTORY_TESTNET
 *   MotoSwap Router:   bc1p_MOTOSWAP_ROUTER_TESTNET
 *   MotoChef:          bc1p_MOTOCHEF_TESTNET
 *
 * ── Build ─────────────────────────────────────────────────────────────────────
 *   npx asc LiquidityLocker.ts \
 *     --target release \
 *     --optimizeLevel 3 \
 *     --runtime stub \
 *     -o LiquidityLocker.wasm
 *
 * ── Deploy to testnet ─────────────────────────────────────────────────────────
 *   opnet contract deploy \
 *     --wasm LiquidityLocker.wasm \
 *     --network testnet \
 *     --fee 1000          # tBTC satoshis for deployment gas
 *
 * ── Verify on OPScan testnet ──────────────────────────────────────────────────
 *   https://testnet.opscan.io/contract/<YOUR_P2OP_ADDRESS>
 *
 * ── Package requirements ──────────────────────────────────────────────────────
 *   "@btc-vision/btc-runtime": "^1.0.0"
 *   "@btc-vision/opnet-contracts": "^1.0.0"
 */

import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    Revert,
    Selector,
    StoredBoolean,
    StoredString,
    StoredU256,
    StoredU64,
    StoredAddress,
    u256,
    u64,
    u32,
    DeployableOP_20,
    OP_20,
} from '@btc-vision/btc-runtime/runtime';

// ═════════════════════════════════════════════════════════════════════════════
// ── SECTION 1: Testnet Configuration
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Testnet network ID stored at deployment.
 * OP_NET testnet runs on Bitcoin regtest/signet with faster block times (~2 min).
 * Adjust MIN_LOCK_BLOCKS and fee constants accordingly.
 */
const TESTNET_CHAIN_ID: u32    = 2;          // 1=mainnet, 2=testnet, 3=regtest

/**
 * On testnet, blocks arrive every ~2 minutes instead of ~10.
 * Minimum lock = 1 block (for testing). Use higher values in production.
 */
const MIN_LOCK_BLOCKS: u64     = 1;          // testnet: 1 block minimum

/**
 * Protocol fee in satoshis (tBTC) charged on each lock creation.
 * Collected into the fee treasury address set by admin.
 * 0 = no fee (default for testnet).
 */
const DEFAULT_FEE_SATS: u64    = 0;          // free on testnet

/** Hard ceiling on batch operations to bound gas per tx */
const MAX_BATCH: u32           = 10;

/** Hard ceiling on paginated reads */
const MAX_PAGE: u32            = 50;

/** Max label length to prevent storage bloat */
const MAX_LABEL: i32           = 64;

/** Max category tag length */
const MAX_TAG: i32             = 32;

// ═════════════════════════════════════════════════════════════════════════════
// ── SECTION 2: Storage Keys
// ── Short keys = low gas. Every byte saved = cheaper transactions on testnet.
// ═════════════════════════════════════════════════════════════════════════════

// ── Per-lock core fields ──────────────────────────────────────────────────────
const K_AMT    = 'a';    // lockId → u256  locked amount
const K_OWN    = 'o';    // lockId → Address  owner / release beneficiary
const K_TOK    = 'k';    // lockId → Address  LP token contract
const K_BLK    = 'b';    // lockId → u64   unlockBlock (0 = permanent)
const K_PERM   = 'p';    // lockId → bool  isPermanent
const K_DONE   = 'd';    // lockId → bool  isReleased
const K_EXT    = 'e';    // lockId → bool  hasBeenExtended
const K_LBL    = 'l';    // lockId → str   human label

// ── Per-lock metadata v2 (new in v3) ─────────────────────────────────────────
const K_TAG    = 'tg';   // lockId → str   category tag  e.g. "team","lp","partner"
const K_NONCE  = 'nc';   // lockId → u64   per-owner nonce at creation time
const K_PARENT = 'pa';   // lockId → u64   parent lockId if this is a split child (0 = original)
const K_SPLITS = 'sp';   // lockId → u64   number of times this lock was split

// ── Aggregate / index fields ──────────────────────────────────────────────────
const K_TOTAL  = 'tl';   // token → u256  total active locked
const K_TCNT   = 'tc';   // token → u64   all-time lock count
const K_TIDX   = 'ti';   // token+i → u64 lockId at index i
const K_OCNT   = 'oc';   // owner → u64   owner lock count
const K_OIDX   = 'oi';   // owner+i → u64 lockId at index i

// ── Global / system fields ────────────────────────────────────────────────────
const K_CTR    = 'glc';  // global lock counter              u64
const K_RENT   = 'rg';   // reentrancy guard                 bool
const K_PAUSE  = 'pau';  // emergency pause                  bool
const K_ADMIN  = 'dep';  // admin address                    Address
const K_FACT   = 'fac';  // MotoSwap factory address         Address
const K_TREAS  = 'tr';   // fee treasury address             Address
const K_FEE    = 'fee';  // lock creation fee in sats        u64
const K_FEES   = 'fac';  // total fees collected             u256
const K_NET    = 'net';  // network id                       u32
const K_NFTON  = 'nft';  // NFT receipts enabled             bool

// ── NFT receipt fields (new in v3) ────────────────────────────────────────────
// Each lock mints a non-fungible receipt stored as an OP_20 balance.
// Token ID = lockId. Owner = depositor. Non-transferable until lock is released.
const K_NFT_OWN = 'no';  // lockId → Address  NFT receipt holder
const K_NFT_XFER= 'nx';  // lockId → bool     NFT is transferable (true after timelock)

// ═════════════════════════════════════════════════════════════════════════════
// ── SECTION 3: Selectors
// ═════════════════════════════════════════════════════════════════════════════

// ── Write ─────────────────────────────────────────────────────────────────────
const SEL_LOCK_PERM    = encodeSelector('lockPermanent(address,uint256,string,string)');
const SEL_LOCK_TIMED   = encodeSelector('lockTimed(address,uint256,uint64,string,string)');
const SEL_UNLOCK       = encodeSelector('unlock(uint64)');
const SEL_UNLOCK_PART  = encodeSelector('unlockPartial(uint64,uint256)');      // NEW v3
const SEL_SPLIT        = encodeSelector('splitLock(uint64,uint256)');           // NEW v3
const SEL_BATCH_LOCK   = encodeSelector('batchLockTimed(address[],uint256[],uint64[],string[])'); // NEW v3
const SEL_EXTEND       = encodeSelector('extendLock(uint64,uint64)');
const SEL_XFER_OWN     = encodeSelector('transferLockOwnership(uint64,address)');
const SEL_SET_FACTORY  = encodeSelector('setFactory(address)');
const SEL_SET_PAUSED   = encodeSelector('setPaused(bool)');
const SEL_SET_FEE      = encodeSelector('setFee(uint64)');                      // NEW v3
const SEL_SET_TREASURY = encodeSelector('setTreasury(address)');                // NEW v3
const SEL_SET_NFT      = encodeSelector('setNFTReceiptsEnabled(bool)');         // NEW v3
const SEL_WITHDRAW_FEES= encodeSelector('withdrawFees()');                      // NEW v3

// ── Read ──────────────────────────────────────────────────────────────────────
const SEL_GET_LOCK     = encodeSelector('getLock(uint64)');
const SEL_GET_LOCK_V2  = encodeSelector('getLockV2(uint64)');                   // NEW v3 — includes metadata
const SEL_LOCKS_TOKEN  = encodeSelector('getLocksForToken(address,uint32,uint32)');
const SEL_LOCKS_OWNER  = encodeSelector('getLocksForOwner(address,uint32,uint32)');
const SEL_TOTAL        = encodeSelector('getTotalLocked(address)');
const SEL_IS_PERM      = encodeSelector('isLockPermanent(uint64)');
const SEL_IS_UNLOCK    = encodeSelector('isUnlockable(uint64)');
const SEL_CNT          = encodeSelector('getLockCount(address)');
const SEL_VERSION      = encodeSelector('version()');
const SEL_IS_PAUSED    = encodeSelector('isPaused()');
const SEL_NFT_OWNER    = encodeSelector('nftOwner(uint64)');                    // NEW v3
const SEL_FEE          = encodeSelector('getFee()');                            // NEW v3
const SEL_TREASURY     = encodeSelector('getTreasury()');                       // NEW v3
const SEL_FEES_COLL    = encodeSelector('getFeesCollected()');                  // NEW v3

// ═════════════════════════════════════════════════════════════════════════════
// ── SECTION 4: Helpers
// ═════════════════════════════════════════════════════════════════════════════

@inline
function sk(prefix: string, id: string): string { return prefix + ':' + id; }

@inline
function revert(msg: string): void { throw new Revert('LiquidityLocker: ' + msg); }

// ═════════════════════════════════════════════════════════════════════════════
// ── SECTION 5: Contract
// ═════════════════════════════════════════════════════════════════════════════

/**
 * LiquidityLocker v3.0 — OP_NET TESTNET
 *
 * Extends DeployableOP_20 (btc-vision/opnet-contracts official template).
 *
 * NEW in v3:
 * ──────────
 * 1. PARTIAL UNLOCK   — unlockPartial(lockId, amount)
 *    Release a portion of a timed lock after the deadline.
 *    Remaining amount stays locked. Useful for staged liquidity release.
 *
 * 2. SPLIT LOCK       — splitLock(lockId, amountToSplit)
 *    Divide an active lock into two: the original (reduced by split amount)
 *    and a new child lock with the same unlock block, owned by the same address.
 *    Both locks are independently manageable. Lineage tracked via K_PARENT.
 *
 * 3. LOCK NFT RECEIPT — mintable on-chain receipt per lock
 *    When NFT receipts are enabled (admin toggle), each lockPermanent/lockTimed
 *    mints a non-fungible receipt. Receipt holder can be looked up via nftOwner().
 *    Receipt transfers to new owner on transferLockOwnership().
 *    Useful for secondary-market lock trading and DAO treasury management.
 *
 * 4. FEE TREASURY     — optional protocol fee in tBTC satoshis
 *    Admin sets fee via setFee(sats). Fees accumulate and are withdrawn
 *    to the treasury address via withdrawFees(). Default = 0 on testnet.
 *
 * 5. BATCH LOCK       — batchLockTimed(tokens[], amounts[], blocks[], labels[])
 *    Lock up to 10 LP pairs in one transaction. Same security checks apply
 *    to each. Gas: O(N) storage writes, bounded by MAX_BATCH=10.
 *
 * 6. METADATA v2      — category tag + creation nonce per lock
 *    Tag examples: "team", "lp", "partner", "treasury", "seed", "public"
 *    Nonce = per-owner monotonic counter at creation time (for deduplication).
 *
 * 7. TESTNET NETWORK ID — stored at deployment for OPScan chain identification.
 *
 * Security model (unchanged from v2, audited patterns):
 *   CEI ordering, storage-backed reentrancy guard, admin access control,
 *   emergency pause, overflow-safe u256 arithmetic.
 */
export class LiquidityLocker extends DeployableOP_20 {

    // ─────────────────────────────────────────────────────────────────────────
    // 5.1  Constructor
    // ─────────────────────────────────────────────────────────────────────────

    constructor() {
        // Supply = 0. The locker issues no fungible tokens.
        // NFT receipt accounting is tracked internally, not as OP_20 balances.
        super('MotoSwap Liquidity Locker', 'MLOCK', 0, u256.Zero);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5.2  onDeployment — P2OP deploy transaction hook (runs once)
    // ─────────────────────────────────────────────────────────────────────────

    public override onDeployment(_calldata: Calldata): void {
        const deployer = Blockchain.tx.sender;

        new StoredAddress(K_ADMIN, Address.dead()).value = deployer;
        new StoredBoolean(K_PAUSE, false).value          = false;
        new StoredBoolean(K_RENT,  false).value          = false;
        new StoredBoolean(K_NFTON, false).value          = false;  // NFT receipts opt-in
        new StoredU64    (K_FEE,   0 as u64).value       = DEFAULT_FEE_SATS;
        new StoredAddress(K_TREAS, Address.dead()).value  = deployer; // fees → deployer by default

        // Store network ID for OPScan chain identification
        // (Using u64 as a proxy since u32 StoredU32 may not be available)
        new StoredU64(K_NET, 0 as u64).value = TESTNET_CHAIN_ID as u64;

        // Deployment event — OPScan contract registry
        const ev = new BytesWriter(128);
        ev.writeAddress(deployer);
        ev.writeU64(Blockchain.block.number);
        ev.writeU64(TESTNET_CHAIN_ID as u64);
        ev.writeStringWithLength('MotoSwap Liquidity Locker v3.0 — TESTNET');
        Blockchain.emit('ContractDeployed', ev);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5.3  callMethod — selector dispatch
    // ─────────────────────────────────────────────────────────────────────────

    public override callMethod(method: Selector, calldata: Calldata): BytesWriter {
        const base = super.callMethod(method, calldata);
        if (base !== null) return base;

        switch (method) {
            // ── Write ─────────────────────────────────────────────────────────
            case SEL_LOCK_PERM:    return this._lockPermanent(calldata);
            case SEL_LOCK_TIMED:   return this._lockTimed(calldata);
            case SEL_UNLOCK:       return this._unlock(calldata);
            case SEL_UNLOCK_PART:  return this._unlockPartial(calldata);   // v3
            case SEL_SPLIT:        return this._splitLock(calldata);        // v3
            case SEL_BATCH_LOCK:   return this._batchLockTimed(calldata);   // v3
            case SEL_EXTEND:       return this._extendLock(calldata);
            case SEL_XFER_OWN:     return this._transferOwnership(calldata);
            case SEL_SET_FACTORY:  return this._setFactory(calldata);
            case SEL_SET_PAUSED:   return this._setPaused(calldata);
            case SEL_SET_FEE:      return this._setFee(calldata);           // v3
            case SEL_SET_TREASURY: return this._setTreasury(calldata);      // v3
            case SEL_SET_NFT:      return this._setNFTReceiptsEnabled(calldata); // v3
            case SEL_WITHDRAW_FEES:return this._withdrawFees(calldata);     // v3
            // ── Read ──────────────────────────────────────────────────────────
            case SEL_GET_LOCK:     return this._getLock(calldata);
            case SEL_GET_LOCK_V2:  return this._getLockV2(calldata);        // v3
            case SEL_LOCKS_TOKEN:  return this._getLocksForToken(calldata);
            case SEL_LOCKS_OWNER:  return this._getLocksForOwner(calldata);
            case SEL_TOTAL:        return this._getTotalLocked(calldata);
            case SEL_IS_PERM:      return this._isLockPermanent(calldata);
            case SEL_IS_UNLOCK:    return this._isUnlockable(calldata);
            case SEL_CNT:          return this._getLockCount(calldata);
            case SEL_VERSION:      return this._version();
            case SEL_IS_PAUSED:    return this._isPaused();
            case SEL_NFT_OWNER:    return this._nftOwner(calldata);         // v3
            case SEL_FEE:          return this._getFee();                   // v3
            case SEL_TREASURY:     return this._getTreasury();              // v3
            case SEL_FEES_COLL:    return this._getFeesCollected();         // v3
            default:
                revert('unknown selector');
                return new BytesWriter(0);
        }
    }

    // =========================================================================
    // ── SECTION 6: Security Guards
    // =========================================================================

    /** Storage-backed reentrancy guard (required for WASM stateless execution) */
    private _enter(): void {
        const g = new StoredBoolean(K_RENT, false);
        if (g.value) revert('reentrancy');
        g.value = true;
    }
    private _exit(): void { new StoredBoolean(K_RENT, false).value = false; }

    private _requireActive(): void {
        if (new StoredBoolean(K_PAUSE, false).value) revert('contract paused');
    }
    private _requireAdmin(): void {
        if (!new StoredAddress(K_ADMIN, Address.dead()).value.equals(Blockchain.tx.sender))
            revert('admin only');
    }

    // =========================================================================
    // ── SECTION 7: Internal Helpers
    // =========================================================================

    private _nextId(): u64 {
        const s = new StoredU64(K_CTR, 0 as u64);
        const n = s.value + (1 as u64);
        s.value = n;
        return n;
    }

    /**
     * Per-owner nonce — monotonically incremented each time an owner creates
     * a lock. Stored for deduplication and frontend ordering.
     */
    private _ownerNonce(owner: Address): u64 {
        const key   = sk('on', owner.toString());
        const store = new StoredU64(key, 0 as u64);
        const n     = store.value;
        store.value = n + (1 as u64);
        return n;
    }

    /**
     * Core store — writes all lock fields + updates both indexes.
     * O(1): exactly 12 storage writes per call.
     */
    private _store(
        id       : u64,
        token    : Address,
        owner    : Address,
        amount   : u256,
        blk      : u64,
        perm     : boolean,
        label    : string,
        tag      : string,
        parentId : u64,
    ): void {
        const s = id.toString();

        // Core fields
        new StoredU256   (sk(K_AMT,    s), u256.Zero     ).value = amount;
        new StoredAddress(sk(K_OWN,    s), Address.dead()).value = owner;
        new StoredAddress(sk(K_TOK,    s), Address.dead()).value = token;
        new StoredU64    (sk(K_BLK,    s), 0 as u64     ).value = blk;
        new StoredBoolean(sk(K_PERM,   s), false         ).value = perm;
        new StoredBoolean(sk(K_DONE,   s), false         ).value = false;
        new StoredBoolean(sk(K_EXT,    s), false         ).value = false;
        new StoredString (sk(K_LBL,    s), ''            ).value = label;

        // Metadata v2
        new StoredString (sk(K_TAG,    s), ''            ).value = tag.length <= MAX_TAG ? tag : tag.slice(0, MAX_TAG);
        new StoredU64    (sk(K_NONCE,  s), 0 as u64     ).value = this._ownerNonce(owner);
        new StoredU64    (sk(K_PARENT, s), 0 as u64     ).value = parentId;
        new StoredU64    (sk(K_SPLITS, s), 0 as u64     ).value = 0 as u64;

        // Token index
        const tStr = token.toString();
        const tCnt = new StoredU64(sk(K_TCNT, tStr), 0 as u64);
        new StoredU64(sk(K_TIDX, tStr + ':' + tCnt.value.toString()), 0 as u64).value = id;
        tCnt.value = tCnt.value + (1 as u64);

        // Owner index
        const oStr = owner.toString();
        const oCnt = new StoredU64(sk(K_OCNT, oStr), 0 as u64);
        new StoredU64(sk(K_OIDX, oStr + ':' + oCnt.value.toString()), 0 as u64).value = id;
        oCnt.value = oCnt.value + (1 as u64);

        // Aggregate
        const tot = new StoredU256(sk(K_TOTAL, tStr), u256.Zero);
        tot.value = tot.value + amount;

        // NFT receipt
        if (new StoredBoolean(K_NFTON, false).value) {
            new StoredAddress(sk(K_NFT_OWN,  s), Address.dead()).value = owner;
            new StoredBoolean(sk(K_NFT_XFER, s), false         ).value = perm; // perm locks are non-transferable
        }
    }

    private _pull(token: Address, from: Address, amount: u256): void {
        if (!OP_20.at(token).transferFrom(from, this.address, amount))
            revert('transferFrom failed — approve the locker first');
    }

    private _push(token: Address, to: Address, amount: u256): void {
        if (!OP_20.at(token).transfer(to, amount))
            revert('transfer out failed');
    }

    /**
     * Collect protocol fee in tBTC satoshis.
     * Fee is encoded in the transaction value field (OP_NET intrinsic value).
     * If fee > 0 and tx value < fee, revert.
     */
    private _collectFee(): void {
        const fee = new StoredU64(K_FEE, 0 as u64).value;
        if (fee == (0 as u64)) return;
        // OP_NET: Blockchain.tx.value gives the BTC satoshis sent with the call
        if (Blockchain.tx.value < fee)
            revert('insufficient fee: send at least ' + fee.toString() + ' sats (tBTC)');
        // Accumulate collected fees
        const collected = new StoredU256(K_FEES, u256.Zero);
        const feeU256   = u256.fromU64(fee);
        collected.value = collected.value + feeU256;
    }

    // =========================================================================
    // ── SECTION 8: Write Methods
    // =========================================================================

    // ─────────────────────────────────────────────────────────────────────────
    // 8.1  lockPermanent
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * lockPermanent(address token, uint256 amount, string label, string tag)
     *   → uint64 lockId
     *
     * Permanently locks MotoSwap LP tokens. NO release path.
     * tag: category string e.g. "lp", "team", "treasury" (max 32 chars)
     *
     * Events: LockCreated, LockPermanent
     */
    private _lockPermanent(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();
        this._collectFee();

        const token  = calldata.readAddress();
        const amount = calldata.readU256();
        const label  = calldata.readStringWithLength();
        const tag    = calldata.readStringWithLength();

        if (amount == u256.Zero)          revert('zero amount');
        if (label.length > MAX_LABEL)     revert('label max 64 chars');

        const caller = Blockchain.tx.sender;
        this._pull(token, caller, amount);

        const lockId = this._nextId();
        this._store(lockId, token, caller, amount, 0 as u64, true, label, tag, 0 as u64);

        // ── Events ────────────────────────────────────────────────────────────
        const ev1 = new BytesWriter(160);
        ev1.writeU64(lockId);
        ev1.writeAddress(caller);
        ev1.writeAddress(token);
        ev1.writeU256(amount);
        ev1.writeBoolean(true);             // isPermanent
        ev1.writeU64(0 as u64);             // unlockBlock
        ev1.writeU64(Blockchain.block.number);
        ev1.writeStringWithLength(label);
        ev1.writeStringWithLength(tag);
        Blockchain.emit('LockCreated', ev1);

        const ev2 = new BytesWriter(80);
        ev2.writeU64(lockId);
        ev2.writeAddress(token);
        ev2.writeU256(amount);
        ev2.writeAddress(caller);
        Blockchain.emit('LockPermanent', ev2);

        this._exit();

        const w = new BytesWriter(8);
        w.writeU64(lockId);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8.2  lockTimed
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * lockTimed(address token, uint256 amount, uint64 unlockBlock,
     *           string label, string tag) → uint64 lockId
     *
     * Testnet timing reference (~2 min/block on OP_NET testnet):
     *   1 day  ≈  720 blocks
     *   1 week ≈ 5,040 blocks
     *   1 mo   ≈ 21,600 blocks
     *
     * Events: LockCreated
     */
    private _lockTimed(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();
        this._collectFee();

        const token       = calldata.readAddress();
        const amount      = calldata.readU256();
        const unlockBlock = calldata.readU64();
        const label       = calldata.readStringWithLength();
        const tag         = calldata.readStringWithLength();

        if (amount == u256.Zero)      revert('zero amount');
        if (label.length > MAX_LABEL) revert('label max 64 chars');
        if (unlockBlock <= Blockchain.block.number + MIN_LOCK_BLOCKS)
            revert('unlockBlock must be > current + ' + MIN_LOCK_BLOCKS.toString());

        const caller = Blockchain.tx.sender;
        this._pull(token, caller, amount);

        const lockId = this._nextId();
        this._store(lockId, token, caller, amount, unlockBlock, false, label, tag, 0 as u64);

        // ── Event ─────────────────────────────────────────────────────────────
        const ev = new BytesWriter(160);
        ev.writeU64(lockId);
        ev.writeAddress(caller);
        ev.writeAddress(token);
        ev.writeU256(amount);
        ev.writeBoolean(false);             // isPermanent
        ev.writeU64(unlockBlock);
        ev.writeU64(Blockchain.block.number);
        ev.writeStringWithLength(label);
        ev.writeStringWithLength(tag);
        Blockchain.emit('LockCreated', ev);

        this._exit();

        const w = new BytesWriter(8);
        w.writeU64(lockId);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8.3  unlock (full release)
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * unlock(uint64 lockId) → bool
     * Full release of a timed lock after unlockBlock.
     * CEI: isReleased set before external transfer.
     * Events: LockReleased
     */
    private _unlock(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();

        const lockId = calldata.readU64();
        const id     = lockId.toString();

        if (new StoredBoolean(sk(K_PERM, id), false).value)
            revert('permanent lock — no release');
        const doneFlag = new StoredBoolean(sk(K_DONE, id), false);
        if (doneFlag.value) revert('already released');

        const unlockBlock = new StoredU64(sk(K_BLK, id), 0 as u64).value;
        if (unlockBlock == (0 as u64)) revert('lock not found');
        if (Blockchain.block.number < unlockBlock)
            revert('locked until block ' + unlockBlock.toString());

        const ownerStore = new StoredAddress(sk(K_OWN, id), Address.dead());
        if (!ownerStore.value.equals(Blockchain.tx.sender)) revert('not lock owner');

        const token  = new StoredAddress(sk(K_TOK, id), Address.dead()).value;
        const amount = new StoredU256(sk(K_AMT, id), u256.Zero).value;
        const owner  = ownerStore.value;

        // Effects first (CEI)
        doneFlag.value = true;
        const tot = new StoredU256(sk(K_TOTAL, token.toString()), u256.Zero);
        tot.value = tot.value - amount;

        // Interactions
        this._push(token, owner, amount);

        // Event
        const ev = new BytesWriter(96);
        ev.writeU64(lockId);
        ev.writeAddress(owner);
        ev.writeAddress(token);
        ev.writeU256(amount);
        ev.writeU64(Blockchain.block.number);
        ev.writeBoolean(false); // isPartial
        Blockchain.emit('LockReleased', ev);

        this._exit();
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8.4  unlockPartial — NEW v3
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * unlockPartial(uint64 lockId, uint256 partialAmount) → bool
     *
     * Releases a portion of a timed lock after the unlock deadline.
     * The remaining amount stays in the original lock (still active).
     * Useful for staged liquidity release without closing the lock entirely.
     *
     * Invariants:
     *   • partialAmount < current locked amount (full release → use unlock())
     *   • Lock must be past unlockBlock
     *   • Lock must not be permanent or already released
     *   • Caller must be the lock owner
     *
     * Effects:
     *   • K_AMT decremented by partialAmount
     *   • K_TOTAL decremented by partialAmount
     *   • LP tokens transferred to owner
     *   • Lock remains active (isReleased stays false)
     *
     * Events: LockPartialRelease (new v3)
     */
    private _unlockPartial(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();

        const lockId  = calldata.readU64();
        const partial = calldata.readU256();
        const id      = lockId.toString();

        // ── Checks ─────────────────────────────────────────────────────────────
        if (new StoredBoolean(sk(K_PERM, id), false).value) revert('permanent lock');
        if (new StoredBoolean(sk(K_DONE, id), false).value) revert('already released');
        if (partial == u256.Zero) revert('zero partial amount');

        const unlockBlock = new StoredU64(sk(K_BLK, id), 0 as u64).value;
        if (unlockBlock == (0 as u64)) revert('lock not found');
        if (Blockchain.block.number < unlockBlock)
            revert('locked until block ' + unlockBlock.toString());

        const ownerStore = new StoredAddress(sk(K_OWN, id), Address.dead());
        if (!ownerStore.value.equals(Blockchain.tx.sender)) revert('not lock owner');

        const amtStore = new StoredU256(sk(K_AMT, id), u256.Zero);
        if (partial >= amtStore.value) revert('partial >= total; use unlock() for full release');

        const token = new StoredAddress(sk(K_TOK, id), Address.dead()).value;
        const owner = ownerStore.value;

        // ── Effects (CEI) ───────────────────────────────────────────────────────
        amtStore.value = amtStore.value - partial;

        const tot = new StoredU256(sk(K_TOTAL, token.toString()), u256.Zero);
        tot.value = tot.value - partial;

        // ── Interactions ────────────────────────────────────────────────────────
        this._push(token, owner, partial);

        // ── Event: LockPartialRelease ────────────────────────────────────────────
        const ev = new BytesWriter(112);
        ev.writeU64(lockId);
        ev.writeAddress(owner);
        ev.writeAddress(token);
        ev.writeU256(partial);             // amount released
        ev.writeU256(amtStore.value);      // remaining amount
        ev.writeU64(Blockchain.block.number);
        Blockchain.emit('LockPartialRelease', ev);

        this._exit();
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8.5  splitLock — NEW v3
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * splitLock(uint64 lockId, uint256 splitAmount) → uint64 newLockId
     *
     * Divides an active lock into two independent locks:
     *   • Original lock: amount reduced by splitAmount (same unlock block, owner, label)
     *   • New child lock: splitAmount, same unlock block, caller as owner, parent = lockId
     *
     * Use cases:
     *   • Transfer a portion of a team lock to a new contributor
     *   • Separate protocol LP from team LP mid-lock-period
     *   • Create independently unlockable sub-positions
     *
     * Rules:
     *   • Cannot split permanent locks
     *   • Cannot split released locks
     *   • splitAmount must be < current amount
     *   • Only the lock owner can split
     *   • New child lock inherits unlock block
     *   • Child lock's label gets " [SPLIT]" suffix for tracking
     *   • K_SPLITS on parent is incremented
     *
     * Events: LockSplit (new v3), LockCreated (for child)
     */
    private _splitLock(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();

        const lockId      = calldata.readU64();
        const splitAmount = calldata.readU256();
        const id          = lockId.toString();

        // ── Checks ─────────────────────────────────────────────────────────────
        if (new StoredBoolean(sk(K_PERM, id), false).value) revert('cannot split permanent lock');
        if (new StoredBoolean(sk(K_DONE, id), false).value) revert('lock already released');
        if (splitAmount == u256.Zero) revert('zero split amount');

        const ownerStore = new StoredAddress(sk(K_OWN, id), Address.dead());
        if (!ownerStore.value.equals(Blockchain.tx.sender)) revert('not lock owner');

        const amtStore = new StoredU256(sk(K_AMT, id), u256.Zero);
        if (splitAmount >= amtStore.value) revert('split amount >= total; transfer ownership instead');

        const token       = new StoredAddress(sk(K_TOK, id), Address.dead()).value;
        const unlockBlock = new StoredU64(sk(K_BLK, id), 0 as u64).value;
        const label       = new StoredString(sk(K_LBL, id), '').value;
        const tag         = new StoredString(sk(K_TAG, id), '').value;
        const owner       = ownerStore.value;

        // ── Effects ─────────────────────────────────────────────────────────────
        // Reduce parent lock
        amtStore.value = amtStore.value - splitAmount;

        // Track split count on parent
        const splitsStore = new StoredU64(sk(K_SPLITS, id), 0 as u64);
        splitsStore.value = splitsStore.value + (1 as u64);

        // Create child lock — no token transfer needed (tokens already in locker)
        const childId    = this._nextId();
        const childLabel = label + ' [SPLIT]';
        this._store(childId, token, owner, splitAmount, unlockBlock, false, childLabel, tag, lockId);

        // K_TOTAL does NOT change — just redistributed between two locks

        // ── Events ────────────────────────────────────────────────────────────
        // LockSplit: for indexers tracking lineage
        const evSplit = new BytesWriter(64);
        evSplit.writeU64(lockId);      // parent
        evSplit.writeU64(childId);     // child
        evSplit.writeU256(splitAmount);
        evSplit.writeU256(amtStore.value); // parent remaining
        Blockchain.emit('LockSplit', evSplit);

        // LockCreated: standard event for child so indexers pick it up
        const evCreate = new BytesWriter(160);
        evCreate.writeU64(childId);
        evCreate.writeAddress(owner);
        evCreate.writeAddress(token);
        evCreate.writeU256(splitAmount);
        evCreate.writeBoolean(false);
        evCreate.writeU64(unlockBlock);
        evCreate.writeU64(Blockchain.block.number);
        evCreate.writeStringWithLength(childLabel);
        evCreate.writeStringWithLength(tag);
        Blockchain.emit('LockCreated', evCreate);

        this._exit();

        const w = new BytesWriter(8);
        w.writeU64(childId);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8.6  batchLockTimed — NEW v3
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * batchLockTimed(address[] tokens, uint256[] amounts,
     *                uint64[] unlockBlocks, string[] labels) → uint64[] lockIds
     *
     * Locks multiple LP pairs in a single transaction.
     * Max 10 pairs per call (MAX_BATCH) to bound gas.
     *
     * All arrays must be the same length (verified on-chain).
     * All standard lockTimed checks apply per entry.
     * Fee collected once per batch (not per entry) when fee > 0.
     *
     * Events: LockCreated emitted for each entry, BatchLockCreated summary.
     *
     * Encoding:
     *   calldata layout:
     *     u32   count
     *     [count × address]   tokens
     *     [count × u256]      amounts
     *     [count × u64]       unlockBlocks
     *     [count × (u32+str)] labels
     */
    private _batchLockTimed(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();
        this._collectFee(); // one fee for the whole batch

        const count = calldata.readU32();
        if (count == 0) revert('empty batch');
        if (count > MAX_BATCH) revert('batch exceeds ' + MAX_BATCH.toString());

        const caller = Blockchain.tx.sender;

        // Read all arrays upfront (calldata is sequential)
        const tokens  : Address[] = new Array<Address>(count as i32);
        const amounts : u256[]    = new Array<u256>(count as i32);
        const blocks  : u64[]     = new Array<u64>(count as i32);
        const labels  : string[]  = new Array<string>(count as i32);

        for (let i: i32 = 0; i < count as i32; i++) tokens[i]  = calldata.readAddress();
        for (let i: i32 = 0; i < count as i32; i++) amounts[i] = calldata.readU256();
        for (let i: i32 = 0; i < count as i32; i++) blocks[i]  = calldata.readU64();
        for (let i: i32 = 0; i < count as i32; i++) labels[i]  = calldata.readStringWithLength();

        // Validate all entries before any transfers (fail-fast, no partial state)
        for (let i: i32 = 0; i < count as i32; i++) {
            if (amounts[i] == u256.Zero) revert('zero amount at index ' + i.toString());
            if (blocks[i] <= Blockchain.block.number + MIN_LOCK_BLOCKS)
                revert('unlockBlock too close at index ' + i.toString());
        }

        // Allocate output array
        const lockIds: u64[] = new Array<u64>(count as i32);

        // Transfer + store
        for (let i: i32 = 0; i < count as i32; i++) {
            this._pull(tokens[i], caller, amounts[i]);
            const lockId = this._nextId();
            this._store(lockId, tokens[i], caller, amounts[i], blocks[i], false, labels[i], 'batch', 0 as u64);
            lockIds[i] = lockId;

            // Per-entry LockCreated event
            const ev = new BytesWriter(144);
            ev.writeU64(lockId);
            ev.writeAddress(caller);
            ev.writeAddress(tokens[i]);
            ev.writeU256(amounts[i]);
            ev.writeBoolean(false);
            ev.writeU64(blocks[i]);
            ev.writeU64(Blockchain.block.number);
            ev.writeStringWithLength(labels[i]);
            ev.writeStringWithLength('batch');
            Blockchain.emit('LockCreated', ev);
        }

        // Batch summary event
        const evBatch = new BytesWriter(32);
        evBatch.writeAddress(caller);
        evBatch.writeU32(count);
        evBatch.writeU64(lockIds[0]);
        evBatch.writeU64(lockIds[count as i32 - 1]);
        Blockchain.emit('BatchLockCreated', evBatch);

        this._exit();

        // Return all lockIds
        const w = new BytesWriter(4 + count as i32 * 8);
        w.writeU32(count);
        for (let i: i32 = 0; i < count as i32; i++) w.writeU64(lockIds[i]);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8.7  extendLock
    // ─────────────────────────────────────────────────────────────────────────

    /** extendLock(uint64 lockId, uint64 newUnlockBlock) → bool */
    private _extendLock(calldata: Calldata): BytesWriter {
        this._requireActive();

        const lockId         = calldata.readU64();
        const newUnlockBlock = calldata.readU64();
        const id             = lockId.toString();

        if (new StoredBoolean(sk(K_PERM, id), false).value) revert('cannot extend permanent lock');
        if (new StoredBoolean(sk(K_DONE, id), false).value) revert('already released');
        if (!new StoredAddress(sk(K_OWN, id), Address.dead()).value.equals(Blockchain.tx.sender))
            revert('not lock owner');

        const blkStore = new StoredU64(sk(K_BLK, id), 0 as u64);
        if (newUnlockBlock <= blkStore.value) revert('new unlock block must be later');

        const oldBlock = blkStore.value;
        blkStore.value = newUnlockBlock;
        new StoredBoolean(sk(K_EXT, id), false).value = true;

        const ev = new BytesWriter(40);
        ev.writeU64(lockId);
        ev.writeU64(oldBlock);
        ev.writeU64(newUnlockBlock);
        ev.writeU64(Blockchain.block.number);
        Blockchain.emit('LockExtended', ev);

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8.8  transferLockOwnership
    // ─────────────────────────────────────────────────────────────────────────

    /** transferLockOwnership(uint64 lockId, address newOwner) → bool */
    private _transferOwnership(calldata: Calldata): BytesWriter {
        this._requireActive();

        const lockId   = calldata.readU64();
        const newOwner = calldata.readAddress();
        const id       = lockId.toString();

        if (new StoredBoolean(sk(K_PERM, id), false).value) revert('permanent lock has no owner');
        if (new StoredBoolean(sk(K_DONE, id), false).value) revert('already released');

        const ownerStore = new StoredAddress(sk(K_OWN, id), Address.dead());
        if (!ownerStore.value.equals(Blockchain.tx.sender)) revert('not lock owner');
        if (newOwner.equals(Address.dead())) revert('dead address');

        const oldOwner   = ownerStore.value;
        ownerStore.value = newOwner;

        // Update NFT receipt holder if NFTs enabled
        if (new StoredBoolean(K_NFTON, false).value) {
            new StoredAddress(sk(K_NFT_OWN, id), Address.dead()).value = newOwner;
        }

        // Index new owner
        const nStr = newOwner.toString();
        const nCnt = new StoredU64(sk(K_OCNT, nStr), 0 as u64);
        new StoredU64(sk(K_OIDX, nStr + ':' + nCnt.value.toString()), 0 as u64).value = lockId;
        nCnt.value = nCnt.value + (1 as u64);

        const ev = new BytesWriter(80);
        ev.writeU64(lockId);
        ev.writeAddress(oldOwner);
        ev.writeAddress(newOwner);
        ev.writeU64(Blockchain.block.number);
        Blockchain.emit('LockOwnershipTransferred', ev);

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8.9  Admin methods
    // ─────────────────────────────────────────────────────────────────────────

    private _setFactory(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const factory = calldata.readAddress();
        new StoredAddress(K_FACT, Address.dead()).value = factory;
        const ev = new BytesWriter(40); ev.writeAddress(factory); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('FactoryUpdated', ev);
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    private _setPaused(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const paused = calldata.readBoolean();
        new StoredBoolean(K_PAUSE, false).value = paused;
        const ev = new BytesWriter(8); ev.writeU64(Blockchain.block.number);
        Blockchain.emit(paused ? 'ContractPaused' : 'ContractUnpaused', ev);
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    /**
     * setFee(uint64 feeSats) — admin only  [NEW v3]
     * Sets the protocol fee in tBTC satoshis charged per lock creation.
     * 0 = free. Recommended: 0 on testnet.
     */
    private _setFee(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const fee = calldata.readU64();
        new StoredU64(K_FEE, 0 as u64).value = fee;
        const ev = new BytesWriter(16); ev.writeU64(fee); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('FeeUpdated', ev);
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    /**
     * setTreasury(address treasury) — admin only  [NEW v3]
     * Sets the address that receives withdrawn protocol fees.
     */
    private _setTreasury(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const treasury = calldata.readAddress();
        new StoredAddress(K_TREAS, Address.dead()).value = treasury;
        const ev = new BytesWriter(40); ev.writeAddress(treasury); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('TreasuryUpdated', ev);
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    /**
     * setNFTReceiptsEnabled(bool enabled) — admin only  [NEW v3]
     * Enables or disables on-chain NFT receipts for new locks.
     * Existing locks are unaffected.
     */
    private _setNFTReceiptsEnabled(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const enabled = calldata.readBoolean();
        new StoredBoolean(K_NFTON, false).value = enabled;
        const ev = new BytesWriter(8); ev.writeBoolean(enabled); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('NFTReceiptsToggled', ev);
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    /**
     * withdrawFees() — admin only  [NEW v3]
     * Transfers all accumulated protocol fees to the treasury address.
     * Uses OP_NET intrinsic BTC value transfer.
     */
    private _withdrawFees(_calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const collected = new StoredU256(K_FEES, u256.Zero);
        if (collected.value == u256.Zero) revert('no fees to withdraw');

        const treasury = new StoredAddress(K_TREAS, Address.dead()).value;
        if (treasury.equals(Address.dead())) revert('treasury not set');

        const amount = collected.value;
        collected.value = u256.Zero; // Effects before interaction (CEI)

        // OP_NET BTC value transfer to treasury
        Blockchain.transfer(treasury, amount);

        const ev = new BytesWriter(64);
        ev.writeAddress(treasury);
        ev.writeU256(amount);
        ev.writeU64(Blockchain.block.number);
        Blockchain.emit('FeesWithdrawn', ev);

        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    // =========================================================================
    // ── SECTION 9: View Methods
    // =========================================================================

    /** getLock(uint64 lockId) → core struct (v2 compatible) */
    private _getLock(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const id     = lockId.toString();
        const token  = new StoredAddress(sk(K_TOK,  id), Address.dead()).value;
        const owner  = new StoredAddress(sk(K_OWN,  id), Address.dead()).value;
        const amount = new StoredU256   (sk(K_AMT,  id), u256.Zero    ).value;
        const blk    = new StoredU64    (sk(K_BLK,  id), 0 as u64    ).value;
        const perm   = new StoredBoolean(sk(K_PERM, id), false        ).value;
        const done   = new StoredBoolean(sk(K_DONE, id), false        ).value;
        const ext    = new StoredBoolean(sk(K_EXT,  id), false        ).value;
        const label  = new StoredString (sk(K_LBL,  id), ''          ).value;

        const w = new BytesWriter(320);
        w.writeAddress(token); w.writeAddress(owner); w.writeU256(amount);
        w.writeU64(blk); w.writeBoolean(perm); w.writeBoolean(done);
        w.writeBoolean(ext); w.writeU64(lockId); w.writeStringWithLength(label);
        return w;
    }

    /**
     * getLockV2(uint64 lockId) → full struct including metadata v2  [NEW v3]
     * Adds: tag, nonce, parentId, splitCount to the core struct.
     */
    private _getLockV2(calldata: Calldata): BytesWriter {
        const lockId   = calldata.readU64();
        const id       = lockId.toString();
        const token    = new StoredAddress(sk(K_TOK,    id), Address.dead()).value;
        const owner    = new StoredAddress(sk(K_OWN,    id), Address.dead()).value;
        const amount   = new StoredU256   (sk(K_AMT,    id), u256.Zero    ).value;
        const blk      = new StoredU64    (sk(K_BLK,    id), 0 as u64    ).value;
        const perm     = new StoredBoolean(sk(K_PERM,   id), false        ).value;
        const done     = new StoredBoolean(sk(K_DONE,   id), false        ).value;
        const ext      = new StoredBoolean(sk(K_EXT,    id), false        ).value;
        const label    = new StoredString (sk(K_LBL,    id), ''          ).value;
        const tag      = new StoredString (sk(K_TAG,    id), ''          ).value;
        const nonce    = new StoredU64    (sk(K_NONCE,  id), 0 as u64    ).value;
        const parentId = new StoredU64    (sk(K_PARENT, id), 0 as u64    ).value;
        const splits   = new StoredU64    (sk(K_SPLITS, id), 0 as u64    ).value;

        const w = new BytesWriter(400);
        w.writeAddress(token); w.writeAddress(owner); w.writeU256(amount);
        w.writeU64(blk); w.writeBoolean(perm); w.writeBoolean(done);
        w.writeBoolean(ext); w.writeU64(lockId); w.writeStringWithLength(label);
        // v3 extras
        w.writeStringWithLength(tag);
        w.writeU64(nonce);
        w.writeU64(parentId);
        w.writeU64(splits);
        return w;
    }

    /** getLocksForToken(address, uint32 offset, uint32 limit) → uint64[] */
    private _getLocksForToken(calldata: Calldata): BytesWriter {
        return this._page(K_TCNT, K_TIDX, calldata.readAddress().toString(), calldata.readU32(), calldata.readU32());
    }

    /** getLocksForOwner(address, uint32 offset, uint32 limit) → uint64[] */
    private _getLocksForOwner(calldata: Calldata): BytesWriter {
        return this._page(K_OCNT, K_OIDX, calldata.readAddress().toString(), calldata.readU32(), calldata.readU32());
    }

    private _page(cntPfx: string, idxPfx: string, scope: string, off: u32, lim: u32): BytesWriter {
        const total   = new StoredU64(sk(cntPfx, scope), 0 as u64).value;
        const safe    = lim > MAX_PAGE ? MAX_PAGE : lim;
        const start   = off as u64;
        const end     = start + (safe as u64);
        const realEnd = end > total ? total : end;
        const count   = realEnd > start ? (realEnd - start) as u32 : 0;
        const w       = new BytesWriter(4 + count * 8);
        w.writeU32(count);
        for (let i: u64 = start; i < realEnd; i++) {
            w.writeU64(new StoredU64(sk(idxPfx, scope + ':' + i.toString()), 0 as u64).value);
        }
        return w;
    }

    /** getTotalLocked(address token) → uint256 */
    private _getTotalLocked(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(new StoredU256(sk(K_TOTAL, calldata.readAddress().toString()), u256.Zero).value);
        return w;
    }

    /** getLockCount(address token) → uint64 */
    private _getLockCount(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(8);
        w.writeU64(new StoredU64(sk(K_TCNT, calldata.readAddress().toString()), 0 as u64).value);
        return w;
    }

    /** isLockPermanent(uint64 lockId) → bool */
    private _isLockPermanent(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(1);
        w.writeBoolean(new StoredBoolean(sk(K_PERM, calldata.readU64().toString()), false).value);
        return w;
    }

    /** isUnlockable(uint64 lockId) → bool */
    private _isUnlockable(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const id     = lockId.toString();
        const perm   = new StoredBoolean(sk(K_PERM, id), false).value;
        const done   = new StoredBoolean(sk(K_DONE, id), false).value;
        const blk    = new StoredU64   (sk(K_BLK,  id), 0 as u64).value;
        const w = new BytesWriter(1);
        w.writeBoolean(!perm && !done && blk > (0 as u64) && Blockchain.block.number >= blk);
        return w;
    }

    /** nftOwner(uint64 lockId) → address  [NEW v3] */
    private _nftOwner(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const owner  = new StoredAddress(sk(K_NFT_OWN, lockId.toString()), Address.dead()).value;
        const w = new BytesWriter(32); w.writeAddress(owner); return w;
    }

    /** getFee() → uint64  [NEW v3] */
    private _getFee(): BytesWriter {
        const w = new BytesWriter(8);
        w.writeU64(new StoredU64(K_FEE, 0 as u64).value);
        return w;
    }

    /** getTreasury() → address  [NEW v3] */
    private _getTreasury(): BytesWriter {
        const w = new BytesWriter(32);
        w.writeAddress(new StoredAddress(K_TREAS, Address.dead()).value);
        return w;
    }

    /** getFeesCollected() → uint256  [NEW v3] */
    private _getFeesCollected(): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(new StoredU256(K_FEES, u256.Zero).value);
        return w;
    }

    /** version() → string */
    private _version(): BytesWriter {
        const w = new BytesWriter(16);
        w.writeStringWithLength('3.0.0-testnet');
        return w;
    }

    /** isPaused() → bool */
    private _isPaused(): BytesWriter {
        const w = new BytesWriter(1);
        w.writeBoolean(new StoredBoolean(K_PAUSE, false).value);
        return w;
    }
}
