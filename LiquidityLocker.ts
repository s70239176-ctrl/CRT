import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    encodeSelector,
    OP20InitParameters,
    Revert,
    Selector,
    StoredBoolean,
    StoredString,
    StoredU256,
    StoredU64,
    StoredAddress,
    TransferHelper,
    u256,
    OP20,
} from '@btc-vision/btc-runtime/runtime';

// ─── Testnet Configuration ────────────────────────────────────────────────────
const TESTNET_CHAIN_ID: u64 = 2;
const MIN_LOCK_BLOCKS: u64  = 1;
const DEFAULT_FEE_SATS: u64 = 0;
const MAX_BATCH: u32        = 10;
const MAX_PAGE: u32         = 50;
const MAX_LABEL: i32        = 64;
const MAX_TAG: i32          = 32;

// ─── Storage Keys ─────────────────────────────────────────────────────────────
const K_AMT     = 'a';
const K_OWN     = 'o';
const K_TOK     = 'k';
const K_BLK     = 'b';
const K_PERM    = 'p';
const K_DONE    = 'd';
const K_EXT     = 'e';
const K_LBL     = 'l';
const K_TAG     = 'tg';
const K_NONCE   = 'nc';
const K_PARENT  = 'pa';
const K_SPLITS  = 'sp';
const K_TOTAL   = 'tl';
const K_TCNT    = 'tc';
const K_TIDX    = 'ti';
const K_OCNT    = 'oc';
const K_OIDX    = 'oi';
const K_CTR     = 'glc';
const K_RENT    = 'rg';
const K_PAUSE   = 'pau';
const K_ADMIN   = 'dep';
const K_FACT    = 'fac';
const K_TREAS   = 'tr';
const K_FEE     = 'fee';
const K_FEES    = 'fes';
const K_NET     = 'net';
const K_NFTON   = 'nft';
const K_NFT_OWN = 'no';
const K_NFT_XFER= 'nx';

// ─── Selectors ────────────────────────────────────────────────────────────────
const SEL_LOCK_PERM     = encodeSelector('lockPermanent(address,uint256,string,string)');
const SEL_LOCK_TIMED    = encodeSelector('lockTimed(address,uint256,uint64,string,string)');
const SEL_UNLOCK        = encodeSelector('unlock(uint64)');
const SEL_UNLOCK_PART   = encodeSelector('unlockPartial(uint64,uint256)');
const SEL_SPLIT         = encodeSelector('splitLock(uint64,uint256)');
const SEL_BATCH_LOCK    = encodeSelector('batchLockTimed(address[],uint256[],uint64[],string[])');
const SEL_EXTEND        = encodeSelector('extendLock(uint64,uint64)');
const SEL_XFER_OWN      = encodeSelector('transferLockOwnership(uint64,address)');
const SEL_SET_FACTORY   = encodeSelector('setFactory(address)');
const SEL_SET_PAUSED    = encodeSelector('setPaused(bool)');
const SEL_SET_FEE       = encodeSelector('setFee(uint64)');
const SEL_SET_TREASURY  = encodeSelector('setTreasury(address)');
const SEL_SET_NFT       = encodeSelector('setNFTReceiptsEnabled(bool)');
const SEL_WITHDRAW_FEES = encodeSelector('withdrawFees()');
const SEL_GET_LOCK      = encodeSelector('getLock(uint64)');
const SEL_GET_LOCK_V2   = encodeSelector('getLockV2(uint64)');
const SEL_LOCKS_TOKEN   = encodeSelector('getLocksForToken(address,uint32,uint32)');
const SEL_LOCKS_OWNER   = encodeSelector('getLocksForOwner(address,uint32,uint32)');
const SEL_TOTAL         = encodeSelector('getTotalLocked(address)');
const SEL_IS_PERM       = encodeSelector('isLockPermanent(uint64)');
const SEL_IS_UNLOCK     = encodeSelector('isUnlockable(uint64)');
const SEL_CNT           = encodeSelector('getLockCount(address)');
const SEL_VERSION       = encodeSelector('version()');
const SEL_IS_PAUSED     = encodeSelector('isPaused()');
const SEL_NFT_OWNER     = encodeSelector('nftOwner(uint64)');
const SEL_FEE           = encodeSelector('getFee()');
const SEL_TREASURY      = encodeSelector('getTreasury()');
const SEL_FEES_COLL     = encodeSelector('getFeesCollected()');

// ─── Helpers ──────────────────────────────────────────────────────────────────
@inline
function sk(prefix: string, id: string): string { return prefix + ':' + id; }

@inline
function revert(msg: string): void { throw new Revert('LiquidityLocker: ' + msg); }

// ─── Contract ─────────────────────────────────────────────────────────────────

/**
 * LiquidityLocker v3.0 — MotoSwap LP token locker for OP_NET TESTNET.
 *
 * Extends OP20 so it can optionally issue NFT receipt tokens.
 * All locking logic is handled via execute() selector dispatch.
 */
export class LiquidityLocker extends OP20 {

    public constructor() {
        super();
    }

    public override onDeployment(_calldata: Calldata): void {
        // Initialise as a zero-supply token (NFT receipts only, no fungible supply)
        this.instantiate(new OP20InitParameters(
            u256.Zero,
            0,
            'MotoSwap Liquidity Locker',
            'MLOCK',
        ));

        const deployer = Blockchain.tx.sender;
        new StoredAddress(K_ADMIN, Address.dead()).value = deployer;
        new StoredBoolean(K_PAUSE, false).value          = false;
        new StoredBoolean(K_RENT,  false).value          = false;
        new StoredBoolean(K_NFTON, false).value          = false;
        new StoredU64    (K_FEE,   0 as u64).value       = DEFAULT_FEE_SATS;
        new StoredAddress(K_TREAS, Address.dead()).value  = deployer;
        new StoredU64    (K_NET,   0 as u64).value       = TESTNET_CHAIN_ID;

        const ev = new BytesWriter(128);
        ev.writeAddress(deployer);
        ev.writeU64(Blockchain.block.number);
        ev.writeU64(TESTNET_CHAIN_ID);
        ev.writeStringWithLength('MotoSwap Liquidity Locker v3.0 — TESTNET');
        Blockchain.emit('ContractDeployed', ev);
    }

    public override execute(method: Selector, calldata: Calldata): BytesWriter {
        // Delegate OP20 built-ins first
        const base = super.execute(method, calldata);
        if (base !== null) return base;

        switch (method) {
            case SEL_LOCK_PERM:     return this._lockPermanent(calldata);
            case SEL_LOCK_TIMED:    return this._lockTimed(calldata);
            case SEL_UNLOCK:        return this._unlock(calldata);
            case SEL_UNLOCK_PART:   return this._unlockPartial(calldata);
            case SEL_SPLIT:         return this._splitLock(calldata);
            case SEL_BATCH_LOCK:    return this._batchLockTimed(calldata);
            case SEL_EXTEND:        return this._extendLock(calldata);
            case SEL_XFER_OWN:      return this._transferOwnership(calldata);
            case SEL_SET_FACTORY:   return this._setFactory(calldata);
            case SEL_SET_PAUSED:    return this._setPaused(calldata);
            case SEL_SET_FEE:       return this._setFee(calldata);
            case SEL_SET_TREASURY:  return this._setTreasury(calldata);
            case SEL_SET_NFT:       return this._setNFTReceiptsEnabled(calldata);
            case SEL_WITHDRAW_FEES: return this._withdrawFees(calldata);
            case SEL_GET_LOCK:      return this._getLock(calldata);
            case SEL_GET_LOCK_V2:   return this._getLockV2(calldata);
            case SEL_LOCKS_TOKEN:   return this._getLocksForToken(calldata);
            case SEL_LOCKS_OWNER:   return this._getLocksForOwner(calldata);
            case SEL_TOTAL:         return this._getTotalLocked(calldata);
            case SEL_IS_PERM:       return this._isLockPermanent(calldata);
            case SEL_IS_UNLOCK:     return this._isUnlockable(calldata);
            case SEL_CNT:           return this._getLockCount(calldata);
            case SEL_VERSION:       return this._version();
            case SEL_IS_PAUSED:     return this._isPaused();
            case SEL_NFT_OWNER:     return this._nftOwner(calldata);
            case SEL_FEE:           return this._getFee();
            case SEL_TREASURY:      return this._getTreasury();
            case SEL_FEES_COLL:     return this._getFeesCollected();
            default:
                throw new Revert(`Method not found: ${method}`);
        }
    }

    // ─── Security Guards ──────────────────────────────────────────────────────

    private _enter(): void {
        const g = new StoredBoolean(K_RENT, false);
        if (g.value) revert('reentrancy');
        g.value = true;
    }

    private _exit(): void {
        new StoredBoolean(K_RENT, false).value = false;
    }

    private _requireActive(): void {
        if (new StoredBoolean(K_PAUSE, false).value) revert('contract paused');
    }

    private _requireAdmin(): void {
        if (!new StoredAddress(K_ADMIN, Address.dead()).value.equals(Blockchain.tx.sender))
            revert('admin only');
    }

    // ─── Internal Helpers ─────────────────────────────────────────────────────

    private _nextId(): u64 {
        const s = new StoredU64(K_CTR, 0 as u64);
        const n = s.value + (1 as u64);
        s.value = n;
        return n;
    }

    private _ownerNonce(owner: Address): u64 {
        const key   = sk('on', owner.toString());
        const store = new StoredU64(key, 0 as u64);
        const n     = store.value;
        store.value = n + (1 as u64);
        return n;
    }

    private _store(
        id      : u64,
        token   : Address,
        owner   : Address,
        amount  : u256,
        blk     : u64,
        perm    : boolean,
        label   : string,
        tag     : string,
        parentId: u64,
    ): void {
        const s = id.toString();

        new StoredU256   (sk(K_AMT,   s), u256.Zero    ).value = amount;
        new StoredAddress(sk(K_OWN,   s), Address.dead()).value = owner;
        new StoredAddress(sk(K_TOK,   s), Address.dead()).value = token;
        new StoredU64    (sk(K_BLK,   s), 0 as u64    ).value = blk;
        new StoredBoolean(sk(K_PERM,  s), false        ).value = perm;
        new StoredBoolean(sk(K_DONE,  s), false        ).value = false;
        new StoredBoolean(sk(K_EXT,   s), false        ).value = false;
        new StoredString (sk(K_LBL,   s), ''           ).value = label;
        new StoredString (sk(K_TAG,   s), ''           ).value = tag.length <= MAX_TAG ? tag : tag.slice(0, MAX_TAG);
        new StoredU64    (sk(K_NONCE, s), 0 as u64    ).value = this._ownerNonce(owner);
        new StoredU64    (sk(K_PARENT,s), 0 as u64    ).value = parentId;
        new StoredU64    (sk(K_SPLITS,s), 0 as u64    ).value = 0 as u64;

        const tStr = token.toString();
        const tCnt = new StoredU64(sk(K_TCNT, tStr), 0 as u64);
        new StoredU64(sk(K_TIDX, tStr + ':' + tCnt.value.toString()), 0 as u64).value = id;
        tCnt.value = tCnt.value + (1 as u64);

        const oStr = owner.toString();
        const oCnt = new StoredU64(sk(K_OCNT, oStr), 0 as u64);
        new StoredU64(sk(K_OIDX, oStr + ':' + oCnt.value.toString()), 0 as u64).value = id;
        oCnt.value = oCnt.value + (1 as u64);

        const tot = new StoredU256(sk(K_TOTAL, tStr), u256.Zero);
        tot.value = tot.value + amount;

        if (new StoredBoolean(K_NFTON, false).value) {
            new StoredAddress(sk(K_NFT_OWN,  s), Address.dead()).value = owner;
            new StoredBoolean(sk(K_NFT_XFER, s), false         ).value = perm;
        }
    }

    private _pull(token: Address, from: Address, amount: u256): void {
        TransferHelper.transferFrom(token, from, this.address, amount);
    }

    private _push(token: Address, to: Address, amount: u256): void {
        TransferHelper.transfer(token, to, amount);
    }

    private _collectFee(): void {
        const fee = new StoredU64(K_FEE, 0 as u64).value;
        if (fee == (0 as u64)) return;
        if (Blockchain.tx.value < fee)
            revert('insufficient fee: send at least ' + fee.toString() + ' sats');
        const collected = new StoredU256(K_FEES, u256.Zero);
        collected.value = collected.value + u256.fromU64(fee);
    }

    // ─── Write Methods ────────────────────────────────────────────────────────

    private _lockPermanent(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();
        this._collectFee();

        const token  = calldata.readAddress();
        const amount = calldata.readU256();
        const label  = calldata.readStringWithLength();
        const tag    = calldata.readStringWithLength();

        if (amount == u256.Zero)       revert('zero amount');
        if (label.length > MAX_LABEL)  revert('label max 64 chars');

        const caller = Blockchain.tx.sender;
        this._pull(token, caller, amount);

        const lockId = this._nextId();
        this._store(lockId, token, caller, amount, 0 as u64, true, label, tag, 0 as u64);

        const ev1 = new BytesWriter(160);
        ev1.writeU64(lockId); ev1.writeAddress(caller); ev1.writeAddress(token);
        ev1.writeU256(amount); ev1.writeBoolean(true); ev1.writeU64(0 as u64);
        ev1.writeU64(Blockchain.block.number);
        ev1.writeStringWithLength(label); ev1.writeStringWithLength(tag);
        Blockchain.emit('LockCreated', ev1);

        const ev2 = new BytesWriter(80);
        ev2.writeU64(lockId); ev2.writeAddress(token); ev2.writeU256(amount); ev2.writeAddress(caller);
        Blockchain.emit('LockPermanent', ev2);

        this._exit();
        const w = new BytesWriter(8);
        w.writeU64(lockId);
        return w;
    }

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
            revert('unlockBlock too soon');

        const caller = Blockchain.tx.sender;
        this._pull(token, caller, amount);

        const lockId = this._nextId();
        this._store(lockId, token, caller, amount, unlockBlock, false, label, tag, 0 as u64);

        const ev = new BytesWriter(160);
        ev.writeU64(lockId); ev.writeAddress(caller); ev.writeAddress(token);
        ev.writeU256(amount); ev.writeBoolean(false); ev.writeU64(unlockBlock);
        ev.writeU64(Blockchain.block.number);
        ev.writeStringWithLength(label); ev.writeStringWithLength(tag);
        Blockchain.emit('LockCreated', ev);

        this._exit();
        const w = new BytesWriter(8);
        w.writeU64(lockId);
        return w;
    }

    private _unlock(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();

        const lockId = calldata.readU64();
        const id     = lockId.toString();

        if (new StoredBoolean(sk(K_PERM, id), false).value) revert('permanent lock');
        const doneFlag = new StoredBoolean(sk(K_DONE, id), false);
        if (doneFlag.value) revert('already released');

        const unlockBlock = new StoredU64(sk(K_BLK, id), 0 as u64).value;
        if (unlockBlock == (0 as u64)) revert('lock not found');
        if (Blockchain.block.number < unlockBlock)
            revert('locked until block ' + unlockBlock.toString());

        const ownerStore = new StoredAddress(sk(K_OWN, id), Address.dead());
        if (!ownerStore.value.equals(Blockchain.tx.sender)) revert('not lock owner');

        const token  = new StoredAddress(sk(K_TOK, id), Address.dead()).value;
        const amount = new StoredU256   (sk(K_AMT, id), u256.Zero    ).value;
        const owner  = ownerStore.value;

        doneFlag.value = true;
        const tot = new StoredU256(sk(K_TOTAL, token.toString()), u256.Zero);
        tot.value = tot.value - amount;

        this._push(token, owner, amount);

        const ev = new BytesWriter(96);
        ev.writeU64(lockId); ev.writeAddress(owner); ev.writeAddress(token);
        ev.writeU256(amount); ev.writeU64(Blockchain.block.number); ev.writeBoolean(false);
        Blockchain.emit('LockReleased', ev);

        this._exit();
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    private _unlockPartial(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();

        const lockId  = calldata.readU64();
        const partial = calldata.readU256();
        const id      = lockId.toString();

        if (new StoredBoolean(sk(K_PERM, id), false).value) revert('permanent lock');
        if (new StoredBoolean(sk(K_DONE, id), false).value) revert('already released');
        if (partial == u256.Zero) revert('zero partial');

        const unlockBlock = new StoredU64(sk(K_BLK, id), 0 as u64).value;
        if (unlockBlock == (0 as u64)) revert('lock not found');
        if (Blockchain.block.number < unlockBlock)
            revert('locked until block ' + unlockBlock.toString());

        const ownerStore = new StoredAddress(sk(K_OWN, id), Address.dead());
        if (!ownerStore.value.equals(Blockchain.tx.sender)) revert('not lock owner');

        const amtStore = new StoredU256(sk(K_AMT, id), u256.Zero);
        if (partial >= amtStore.value) revert('partial >= total; use unlock()');

        const token = new StoredAddress(sk(K_TOK, id), Address.dead()).value;
        const owner = ownerStore.value;

        amtStore.value = amtStore.value - partial;
        const tot = new StoredU256(sk(K_TOTAL, token.toString()), u256.Zero);
        tot.value = tot.value - partial;

        this._push(token, owner, partial);

        const ev = new BytesWriter(112);
        ev.writeU64(lockId); ev.writeAddress(owner); ev.writeAddress(token);
        ev.writeU256(partial); ev.writeU256(amtStore.value); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('LockPartialRelease', ev);

        this._exit();
        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    private _splitLock(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();

        const lockId      = calldata.readU64();
        const splitAmount = calldata.readU256();
        const id          = lockId.toString();

        if (new StoredBoolean(sk(K_PERM, id), false).value) revert('cannot split permanent lock');
        if (new StoredBoolean(sk(K_DONE, id), false).value) revert('lock already released');
        if (splitAmount == u256.Zero) revert('zero split amount');

        const ownerStore = new StoredAddress(sk(K_OWN, id), Address.dead());
        if (!ownerStore.value.equals(Blockchain.tx.sender)) revert('not lock owner');

        const amtStore = new StoredU256(sk(K_AMT, id), u256.Zero);
        if (splitAmount >= amtStore.value) revert('split >= total');

        const token       = new StoredAddress(sk(K_TOK,    id), Address.dead()).value;
        const unlockBlock = new StoredU64    (sk(K_BLK,    id), 0 as u64    ).value;
        const label       = new StoredString (sk(K_LBL,    id), ''          ).value;
        const tag         = new StoredString (sk(K_TAG,    id), ''          ).value;
        const owner       = ownerStore.value;

        amtStore.value = amtStore.value - splitAmount;

        const splitsStore = new StoredU64(sk(K_SPLITS, id), 0 as u64);
        splitsStore.value = splitsStore.value + (1 as u64);

        const childId    = this._nextId();
        const childLabel = label + ' [SPLIT]';
        this._store(childId, token, owner, splitAmount, unlockBlock, false, childLabel, tag, lockId);

        const evSplit = new BytesWriter(64);
        evSplit.writeU64(lockId); evSplit.writeU64(childId);
        evSplit.writeU256(splitAmount); evSplit.writeU256(amtStore.value);
        Blockchain.emit('LockSplit', evSplit);

        const evCreate = new BytesWriter(160);
        evCreate.writeU64(childId); evCreate.writeAddress(owner); evCreate.writeAddress(token);
        evCreate.writeU256(splitAmount); evCreate.writeBoolean(false); evCreate.writeU64(unlockBlock);
        evCreate.writeU64(Blockchain.block.number);
        evCreate.writeStringWithLength(childLabel); evCreate.writeStringWithLength(tag);
        Blockchain.emit('LockCreated', evCreate);

        this._exit();
        const w = new BytesWriter(8);
        w.writeU64(childId);
        return w;
    }

    private _batchLockTimed(calldata: Calldata): BytesWriter {
        this._requireActive();
        this._enter();
        this._collectFee();

        const count = calldata.readU32();
        if (count == 0)          revert('empty batch');
        if (count > MAX_BATCH)   revert('batch exceeds max');

        const caller = Blockchain.tx.sender;

        const tokens : Address[] = new Array<Address>(count as i32);
        const amounts: u256[]    = new Array<u256>   (count as i32);
        const blocks : u64[]     = new Array<u64>    (count as i32);
        const labels : string[]  = new Array<string> (count as i32);

        for (let i: i32 = 0; i < count as i32; i++) tokens[i]  = calldata.readAddress();
        for (let i: i32 = 0; i < count as i32; i++) amounts[i] = calldata.readU256();
        for (let i: i32 = 0; i < count as i32; i++) blocks[i]  = calldata.readU64();
        for (let i: i32 = 0; i < count as i32; i++) labels[i]  = calldata.readStringWithLength();

        for (let i: i32 = 0; i < count as i32; i++) {
            if (amounts[i] == u256.Zero) revert('zero amount at index ' + i.toString());
            if (blocks[i] <= Blockchain.block.number + MIN_LOCK_BLOCKS)
                revert('unlockBlock too soon at index ' + i.toString());
        }

        const lockIds: u64[] = new Array<u64>(count as i32);

        for (let i: i32 = 0; i < count as i32; i++) {
            this._pull(tokens[i], caller, amounts[i]);
            const lockId = this._nextId();
            this._store(lockId, tokens[i], caller, amounts[i], blocks[i], false, labels[i], 'batch', 0 as u64);
            lockIds[i] = lockId;

            const ev = new BytesWriter(144);
            ev.writeU64(lockId); ev.writeAddress(caller); ev.writeAddress(tokens[i]);
            ev.writeU256(amounts[i]); ev.writeBoolean(false); ev.writeU64(blocks[i]);
            ev.writeU64(Blockchain.block.number);
            ev.writeStringWithLength(labels[i]); ev.writeStringWithLength('batch');
            Blockchain.emit('LockCreated', ev);
        }

        const evBatch = new BytesWriter(48);
        evBatch.writeAddress(caller); evBatch.writeU32(count);
        evBatch.writeU64(lockIds[0]); evBatch.writeU64(lockIds[count as i32 - 1]);
        Blockchain.emit('BatchLockCreated', evBatch);

        this._exit();
        const w = new BytesWriter(4 + (count as i32) * 8);
        w.writeU32(count);
        for (let i: i32 = 0; i < count as i32; i++) w.writeU64(lockIds[i]);
        return w;
    }

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
        if (newUnlockBlock <= blkStore.value) revert('new block must be later');

        const oldBlock = blkStore.value;
        blkStore.value = newUnlockBlock;
        new StoredBoolean(sk(K_EXT, id), false).value = true;

        const ev = new BytesWriter(40);
        ev.writeU64(lockId); ev.writeU64(oldBlock);
        ev.writeU64(newUnlockBlock); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('LockExtended', ev);

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    private _transferOwnership(calldata: Calldata): BytesWriter {
        this._requireActive();

        const lockId   = calldata.readU64();
        const newOwner = calldata.readAddress();
        const id       = lockId.toString();

        if (new StoredBoolean(sk(K_PERM, id), false).value) revert('permanent lock');
        if (new StoredBoolean(sk(K_DONE, id), false).value) revert('already released');

        const ownerStore = new StoredAddress(sk(K_OWN, id), Address.dead());
        if (!ownerStore.value.equals(Blockchain.tx.sender)) revert('not lock owner');
        if (newOwner.equals(Address.dead())) revert('dead address');

        const oldOwner   = ownerStore.value;
        ownerStore.value = newOwner;

        if (new StoredBoolean(K_NFTON, false).value)
            new StoredAddress(sk(K_NFT_OWN, id), Address.dead()).value = newOwner;

        const nStr = newOwner.toString();
        const nCnt = new StoredU64(sk(K_OCNT, nStr), 0 as u64);
        new StoredU64(sk(K_OIDX, nStr + ':' + nCnt.value.toString()), 0 as u64).value = lockId;
        nCnt.value = nCnt.value + (1 as u64);

        const ev = new BytesWriter(80);
        ev.writeU64(lockId); ev.writeAddress(oldOwner);
        ev.writeAddress(newOwner); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('LockOwnershipTransferred', ev);

        const w = new BytesWriter(1);
        w.writeBoolean(true);
        return w;
    }

    // ─── Admin Methods ────────────────────────────────────────────────────────

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

    private _setFee(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const fee = calldata.readU64();
        new StoredU64(K_FEE, 0 as u64).value = fee;
        const ev = new BytesWriter(16); ev.writeU64(fee); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('FeeUpdated', ev);
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    private _setTreasury(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const treasury = calldata.readAddress();
        new StoredAddress(K_TREAS, Address.dead()).value = treasury;
        const ev = new BytesWriter(40); ev.writeAddress(treasury); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('TreasuryUpdated', ev);
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    private _setNFTReceiptsEnabled(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const enabled = calldata.readBoolean();
        new StoredBoolean(K_NFTON, false).value = enabled;
        const ev = new BytesWriter(9); ev.writeBoolean(enabled); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('NFTReceiptsToggled', ev);
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    private _withdrawFees(_calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const collected = new StoredU256(K_FEES, u256.Zero);
        if (collected.value == u256.Zero) revert('no fees to withdraw');

        const treasury = new StoredAddress(K_TREAS, Address.dead()).value;
        if (treasury.equals(Address.dead())) revert('treasury not set');

        const amount    = collected.value;
        collected.value = u256.Zero;

        Blockchain.transfer(treasury, amount);

        const ev = new BytesWriter(64);
        ev.writeAddress(treasury); ev.writeU256(amount); ev.writeU64(Blockchain.block.number);
        Blockchain.emit('FeesWithdrawn', ev);

        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    // ─── View Methods ─────────────────────────────────────────────────────────

    private _getLock(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const id     = lockId.toString();
        const w = new BytesWriter(320);
        w.writeAddress(new StoredAddress(sk(K_TOK,  id), Address.dead()).value);
        w.writeAddress(new StoredAddress(sk(K_OWN,  id), Address.dead()).value);
        w.writeU256   (new StoredU256   (sk(K_AMT,  id), u256.Zero    ).value);
        w.writeU64    (new StoredU64    (sk(K_BLK,  id), 0 as u64    ).value);
        w.writeBoolean(new StoredBoolean(sk(K_PERM, id), false        ).value);
        w.writeBoolean(new StoredBoolean(sk(K_DONE, id), false        ).value);
        w.writeBoolean(new StoredBoolean(sk(K_EXT,  id), false        ).value);
        w.writeU64    (lockId);
        w.writeStringWithLength(new StoredString(sk(K_LBL, id), '').value);
        return w;
    }

    private _getLockV2(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const id     = lockId.toString();
        const w = new BytesWriter(400);
        w.writeAddress(new StoredAddress(sk(K_TOK,    id), Address.dead()).value);
        w.writeAddress(new StoredAddress(sk(K_OWN,    id), Address.dead()).value);
        w.writeU256   (new StoredU256   (sk(K_AMT,    id), u256.Zero    ).value);
        w.writeU64    (new StoredU64    (sk(K_BLK,    id), 0 as u64    ).value);
        w.writeBoolean(new StoredBoolean(sk(K_PERM,   id), false        ).value);
        w.writeBoolean(new StoredBoolean(sk(K_DONE,   id), false        ).value);
        w.writeBoolean(new StoredBoolean(sk(K_EXT,    id), false        ).value);
        w.writeU64    (lockId);
        w.writeStringWithLength(new StoredString(sk(K_LBL,    id), '').value);
        w.writeStringWithLength(new StoredString(sk(K_TAG,    id), '').value);
        w.writeU64    (new StoredU64    (sk(K_NONCE,  id), 0 as u64    ).value);
        w.writeU64    (new StoredU64    (sk(K_PARENT, id), 0 as u64    ).value);
        w.writeU64    (new StoredU64    (sk(K_SPLITS, id), 0 as u64    ).value);
        return w;
    }

    private _getLocksForToken(calldata: Calldata): BytesWriter {
        return this._page(K_TCNT, K_TIDX, calldata.readAddress().toString(), calldata.readU32(), calldata.readU32());
    }

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
        const w       = new BytesWriter(4 + (count as i32) * 8);
        w.writeU32(count);
        for (let i: u64 = start; i < realEnd; i++)
            w.writeU64(new StoredU64(sk(idxPfx, scope + ':' + i.toString()), 0 as u64).value);
        return w;
    }

    private _getTotalLocked(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(new StoredU256(sk(K_TOTAL, calldata.readAddress().toString()), u256.Zero).value);
        return w;
    }

    private _getLockCount(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(8);
        w.writeU64(new StoredU64(sk(K_TCNT, calldata.readAddress().toString()), 0 as u64).value);
        return w;
    }

    private _isLockPermanent(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(1);
        w.writeBoolean(new StoredBoolean(sk(K_PERM, calldata.readU64().toString()), false).value);
        return w;
    }

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

    private _nftOwner(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeAddress(new StoredAddress(sk(K_NFT_OWN, calldata.readU64().toString()), Address.dead()).value);
        return w;
    }

    private _getFee(): BytesWriter {
        const w = new BytesWriter(8);
        w.writeU64(new StoredU64(K_FEE, 0 as u64).value);
        return w;
    }

    private _getTreasury(): BytesWriter {
        const w = new BytesWriter(32);
        w.writeAddress(new StoredAddress(K_TREAS, Address.dead()).value);
        return w;
    }

    private _getFeesCollected(): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(new StoredU256(K_FEES, u256.Zero).value);
        return w;
    }

    private _version(): BytesWriter {
        const w = new BytesWriter(16);
        w.writeStringWithLength('3.0.0-testnet');
        return w;
    }

    private _isPaused(): BytesWriter {
        const w = new BytesWriter(1);
        w.writeBoolean(new StoredBoolean(K_PAUSE, false).value);
        return w;
    }
}
