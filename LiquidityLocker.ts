import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    ABIDataTypes,
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    EMPTY_POINTER,
    MapOfMap,
    NetEvent,
    OP20,
    OP20InitParameters,
    Revert,
    SafeMath,
    StoredAddress,
    StoredBoolean,
    StoredMapU256,
    StoredString,
    StoredU256,
    StoredU64,
    TransferHelper,
} from '@btc-vision/btc-runtime/runtime';

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_LOCK_BLOCKS: u64 = 1;
const DEFAULT_FEE_SATS: u64 = 0;
const MAX_BATCH: u32 = 10;
const MAX_PAGE: u32 = 50;
const MAX_LABEL: i32 = 64;
const MAX_TAG: i32 = 32;

// ─── Per-lock field IDs (used as part of composite map keys) ─────────────────
// Each lock's fields are stored as: lockData.set(SHA256(lockId || fieldId), value)
const F_AMT:    u256 = u256.fromU32(1);
const F_TOKEN:  u256 = u256.fromU32(2);
const F_OWNER:  u256 = u256.fromU32(3);
const F_BLK:    u256 = u256.fromU32(4);
const F_PERM:   u256 = u256.fromU32(5);
const F_DONE:   u256 = u256.fromU32(6);
const F_EXT:    u256 = u256.fromU32(7);
const F_SPLITS: u256 = u256.fromU32(8);
const F_PARENT: u256 = u256.fromU32(9);

// ─── Events ───────────────────────────────────────────────────────────────────

@final
class LockCreatedEvent extends NetEvent {
    constructor(lockId: u64, caller: Address, token: Address, amount: u256, perm: bool, unlockBlock: u64) {
        const data = new BytesWriter(8 + 32 + 32 + 32 + 1 + 8);
        data.writeU64(lockId);
        data.writeAddress(caller);
        data.writeAddress(token);
        data.writeU256(amount);
        data.writeBoolean(perm);
        data.writeU64(unlockBlock);
        super('LockCreated', data);
    }
}

@final
class LockReleasedEvent extends NetEvent {
    constructor(lockId: u64, owner: Address, token: Address, amount: u256) {
        const data = new BytesWriter(8 + 32 + 32 + 32);
        data.writeU64(lockId);
        data.writeAddress(owner);
        data.writeAddress(token);
        data.writeU256(amount);
        super('LockReleased', data);
    }
}

@final
class LockSplitEvent extends NetEvent {
    constructor(parentId: u64, childId: u64, splitAmount: u256, parentRemaining: u256) {
        const data = new BytesWriter(8 + 8 + 32 + 32);
        data.writeU64(parentId);
        data.writeU64(childId);
        data.writeU256(splitAmount);
        data.writeU256(parentRemaining);
        super('LockSplit', data);
    }
}

@final
class LockExtendedEvent extends NetEvent {
    constructor(lockId: u64, newBlock: u64) {
        const data = new BytesWriter(16);
        data.writeU64(lockId);
        data.writeU64(newBlock);
        super('LockExtended', data);
    }
}

@final
class LockOwnershipTransferredEvent extends NetEvent {
    constructor(lockId: u64, oldOwner: Address, newOwner: Address) {
        const data = new BytesWriter(8 + 32 + 32);
        data.writeU64(lockId);
        data.writeAddress(oldOwner);
        data.writeAddress(newOwner);
        super('LockOwnershipTransferred', data);
    }
}

@final
class ContractDeployedEvent extends NetEvent {
    constructor(deployer: Address) {
        const data = new BytesWriter(32);
        data.writeAddress(deployer);
        super('ContractDeployed', data);
    }
}

// ─── Composite key helper ─────────────────────────────────────────────────────
@inline
function compKey(a: u256, b: u256): u256 {
    const buf = new Uint8Array(64);
    const aBytes = a.toUint8Array(true);
    const bBytes = b.toUint8Array(true);
    // Pad/slice to 32 bytes each
    for (let i = 0; i < 32; i++) buf[i] = i < aBytes.length ? aBytes[aBytes.length - 32 + i] : 0;
    for (let i = 0; i < 32; i++) buf[32 + i] = i < bBytes.length ? bBytes[bBytes.length - 32 + i] : 0;
    return u256.fromBytes(Blockchain.sha256(buf));
}

@inline
function lockKey(lockId: u64, field: u256): u256 {
    return compKey(u256.fromU64(lockId), field);
}

@inline
function addrToU256(addr: Address): u256 {
    const b = addr.toBytes();
    return u256.fromBytes(b);
}

@inline
function u256ToAddr(v: u256): Address {
    const b = v.toUint8Array(true);
    const padded = new Uint8Array(32);
    for (let i = 0; i < 32; i++) padded[i] = i < b.length ? b[b.length - 32 + i] : 0;
    return Address.fromUint8Array(padded);
}

// ─── Contract ─────────────────────────────────────────────────────────────────

@final
export class LiquidityLocker extends OP20 {

    // ── Storage pointers (each Blockchain.nextPointer call returns a unique u16) ──
    private readonly _adminPtr:      u16 = Blockchain.nextPointer;
    private readonly _pausedPtr:     u16 = Blockchain.nextPointer;
    private readonly _rentPtr:       u16 = Blockchain.nextPointer;
    private readonly _feePtr:        u16 = Blockchain.nextPointer;
    private readonly _ctrPtr:        u16 = Blockchain.nextPointer;
    private readonly _feesColPtr:    u16 = Blockchain.nextPointer;
    private readonly _treasPtr:      u16 = Blockchain.nextPointer;
    private readonly _factPtr:       u16 = Blockchain.nextPointer;
    private readonly _lockDataPtr:   u16 = Blockchain.nextPointer;
    private readonly _tknCntPtr:     u16 = Blockchain.nextPointer;
    private readonly _tknIdxPtr:     u16 = Blockchain.nextPointer;
    private readonly _ownCntPtr:     u16 = Blockchain.nextPointer;
    private readonly _ownIdxPtr:     u16 = Blockchain.nextPointer;
    private readonly _totalLockedPtr:u16 = Blockchain.nextPointer;

    // ── Stored instances ──────────────────────────────────────────────────────
    private _admin:        StoredAddress;
    private _paused:       StoredBoolean;
    private _reentrancy:   StoredBoolean;
    private _fee:          StoredU64;
    private _lockCounter:  StoredU64;
    private _feesCollected:StoredU256;
    private _treasury:     StoredAddress;
    private _factory:      StoredAddress;

    // ── Maps ──────────────────────────────────────────────────────────────────
    private _lockData:    StoredMapU256;  // lockKey(id, fieldId) -> value
    private _tknCnt:      StoredMapU256;  // token addr -> count
    private _tknIdx:      StoredMapU256;  // compKey(token, i) -> lockId
    private _ownCnt:      StoredMapU256;  // owner addr -> count
    private _ownIdx:      StoredMapU256;  // compKey(owner, i) -> lockId
    private _totalLocked: StoredMapU256;  // token addr -> total amount

    public constructor() {
        super();

        this._admin        = new StoredAddress(this._adminPtr);
        this._paused       = new StoredBoolean(this._pausedPtr, false);
        this._reentrancy   = new StoredBoolean(this._rentPtr, false);
        this._fee          = new StoredU64(this._feePtr, EMPTY_POINTER);
        this._lockCounter  = new StoredU64(this._ctrPtr, EMPTY_POINTER);
        this._feesCollected= new StoredU256(this._feesColPtr, EMPTY_POINTER);
        this._treasury     = new StoredAddress(this._treasPtr);
        this._factory      = new StoredAddress(this._factPtr);

        this._lockData     = new StoredMapU256(this._lockDataPtr);
        this._tknCnt       = new StoredMapU256(this._tknCntPtr);
        this._tknIdx       = new StoredMapU256(this._tknIdxPtr);
        this._ownCnt       = new StoredMapU256(this._ownCntPtr);
        this._ownIdx       = new StoredMapU256(this._ownIdxPtr);
        this._totalLocked  = new StoredMapU256(this._totalLockedPtr);
    }

    public override onDeployment(_calldata: Calldata): void {
        this.instantiate(new OP20InitParameters(
            u256.Zero, 0,
            'MotoSwap Liquidity Locker',
            'MLOCK',
        ));
        const deployer = Blockchain.tx.sender;
        this._admin.value    = deployer;
        this._treasury.value = deployer;
        this._paused.value   = false;
        this._fee.set(0, DEFAULT_FEE_SATS);
        this.emitEvent(new ContractDeployedEvent(deployer));
    }

    // =========================================================================
    // ── Write Methods ─────────────────────────────────────────────────────────
    // =========================================================================

    @method(
        { name: 'token',  type: ABIDataTypes.ADDRESS  },
        { name: 'amount', type: ABIDataTypes.UINT256  },
        { name: 'label',  type: ABIDataTypes.STRING   },
        { name: 'tag',    type: ABIDataTypes.STRING   },
    )
    @returns({ name: 'lockId', type: ABIDataTypes.UINT64 })
    public lockPermanent(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter(); this._collectFee();

        const token  = calldata.readAddress();
        const amount = calldata.readU256();
        const label  = calldata.readStringWithLength();
        const tag    = calldata.readStringWithLength();

        if (amount.isZero()) throw new Revert('zero amount');
        if (label.length > MAX_LABEL) throw new Revert('label too long');

        const caller = Blockchain.tx.sender;
        TransferHelper.transferFrom(token, caller, this.address, amount);

        const lockId = this._nextId();
        this._store(lockId, token, caller, amount, 0, true, 0);

        this.emitEvent(new LockCreatedEvent(lockId, caller, token, amount, true, 0));
        this._exit();

        const w = new BytesWriter(8); w.writeU64(lockId); return w;
    }

    @method(
        { name: 'token',       type: ABIDataTypes.ADDRESS  },
        { name: 'amount',      type: ABIDataTypes.UINT256  },
        { name: 'unlockBlock', type: ABIDataTypes.UINT64   },
        { name: 'label',       type: ABIDataTypes.STRING   },
        { name: 'tag',         type: ABIDataTypes.STRING   },
    )
    @returns({ name: 'lockId', type: ABIDataTypes.UINT64 })
    public lockTimed(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter(); this._collectFee();

        const token       = calldata.readAddress();
        const amount      = calldata.readU256();
        const unlockBlock = calldata.readU64();
        const label       = calldata.readStringWithLength();
        const tag         = calldata.readStringWithLength();

        if (amount.isZero()) throw new Revert('zero amount');
        if (label.length > MAX_LABEL) throw new Revert('label too long');
        if (unlockBlock <= Blockchain.block.number + MIN_LOCK_BLOCKS)
            throw new Revert('unlockBlock too soon');

        const caller = Blockchain.tx.sender;
        TransferHelper.transferFrom(token, caller, this.address, amount);

        const lockId = this._nextId();
        this._store(lockId, token, caller, amount, unlockBlock, false, 0);

        this.emitEvent(new LockCreatedEvent(lockId, caller, token, amount, false, unlockBlock));
        this._exit();

        const w = new BytesWriter(8); w.writeU64(lockId); return w;
    }

    @method({ name: 'lockId', type: ABIDataTypes.UINT64 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public unlock(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter();

        const lockId = calldata.readU64();

        if (this._getBool(lockId, F_PERM)) throw new Revert('permanent lock');
        if (this._getBool(lockId, F_DONE)) throw new Revert('already released');

        const unlockBlock = this._getU64(lockId, F_BLK);
        if (unlockBlock == 0) throw new Revert('lock not found');
        if (Blockchain.block.number < unlockBlock) throw new Revert('still locked');

        const owner = this._getAddr(lockId, F_OWNER);
        if (!Blockchain.tx.sender.equals(owner)) throw new Revert('not owner');

        const token  = this._getAddr(lockId, F_TOKEN);
        const amount = this._getField(lockId, F_AMT);

        // CEI: effects before interaction
        this._setBool(lockId, F_DONE, true);
        const tKey = addrToU256(token);
        this._totalLocked.set(tKey, SafeMath.sub(this._totalLocked.get(tKey), amount));

        TransferHelper.transfer(token, owner, amount);

        this.emitEvent(new LockReleasedEvent(lockId, owner, token, amount));
        this._exit();

        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method(
        { name: 'lockId',  type: ABIDataTypes.UINT64  },
        { name: 'partial', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public unlockPartial(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter();

        const lockId  = calldata.readU64();
        const partial = calldata.readU256();

        if (this._getBool(lockId, F_PERM)) throw new Revert('permanent lock');
        if (this._getBool(lockId, F_DONE)) throw new Revert('already released');
        if (partial.isZero()) throw new Revert('zero partial');

        const unlockBlock = this._getU64(lockId, F_BLK);
        if (unlockBlock == 0) throw new Revert('lock not found');
        if (Blockchain.block.number < unlockBlock) throw new Revert('still locked');

        const owner = this._getAddr(lockId, F_OWNER);
        if (!Blockchain.tx.sender.equals(owner)) throw new Revert('not owner');

        const current = this._getField(lockId, F_AMT);
        if (partial >= current) throw new Revert('use unlock() for full release');

        const token = this._getAddr(lockId, F_TOKEN);

        // CEI
        this._setField(lockId, F_AMT, SafeMath.sub(current, partial));
        const tKey = addrToU256(token);
        this._totalLocked.set(tKey, SafeMath.sub(this._totalLocked.get(tKey), partial));

        TransferHelper.transfer(token, owner, partial);

        this._exit();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method(
        { name: 'lockId',      type: ABIDataTypes.UINT64  },
        { name: 'splitAmount', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'childLockId', type: ABIDataTypes.UINT64 })
    public splitLock(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter();

        const lockId      = calldata.readU64();
        const splitAmount = calldata.readU256();

        if (this._getBool(lockId, F_PERM)) throw new Revert('cannot split permanent');
        if (this._getBool(lockId, F_DONE)) throw new Revert('already released');
        if (splitAmount.isZero()) throw new Revert('zero split');

        const owner = this._getAddr(lockId, F_OWNER);
        if (!Blockchain.tx.sender.equals(owner)) throw new Revert('not owner');

        const current = this._getField(lockId, F_AMT);
        if (splitAmount >= current) throw new Revert('split >= total');

        const token       = this._getAddr(lockId, F_TOKEN);
        const unlockBlock = this._getU64(lockId, F_BLK);

        const remaining = SafeMath.sub(current, splitAmount);
        this._setField(lockId, F_AMT, remaining);
        this._setU64(lockId, F_SPLITS, this._getU64(lockId, F_SPLITS) + 1);

        const childId = this._nextId();
        this._store(childId, token, owner, splitAmount, unlockBlock, false, lockId);
        // No token transfer needed — tokens already held by this contract

        this.emitEvent(new LockSplitEvent(lockId, childId, splitAmount, remaining));
        this._exit();

        const w = new BytesWriter(8); w.writeU64(childId); return w;
    }

    @method(
        { name: 'count',        type: ABIDataTypes.UINT32    },
        { name: 'tokens',       type: ABIDataTypes.ADDRESS   },
        { name: 'amounts',      type: ABIDataTypes.UINT256   },
        { name: 'unlockBlocks', type: ABIDataTypes.UINT64    },
        { name: 'labels',       type: ABIDataTypes.STRING    },
    )
    @returns({ name: 'lockIds', type: ABIDataTypes.UINT64 })
    public batchLockTimed(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter(); this._collectFee();

        const count = calldata.readU32();
        if (count == 0) throw new Revert('empty batch');
        if (count > MAX_BATCH) throw new Revert('batch too large');

        const caller  = Blockchain.tx.sender;
        const tokens  = new Array<Address>(count as i32);
        const amounts = new Array<u256>(count as i32);
        const blocks  = new Array<u64>(count as i32);
        const labels  = new Array<string>(count as i32);

        for (let i: i32 = 0; i < (count as i32); i++) tokens[i]  = calldata.readAddress();
        for (let i: i32 = 0; i < (count as i32); i++) amounts[i] = calldata.readU256();
        for (let i: i32 = 0; i < (count as i32); i++) blocks[i]  = calldata.readU64();
        for (let i: i32 = 0; i < (count as i32); i++) labels[i]  = calldata.readStringWithLength();

        // Validate all before any state change
        for (let i: i32 = 0; i < (count as i32); i++) {
            if (amounts[i].isZero()) throw new Revert('zero amount in batch');
            if (blocks[i] <= Blockchain.block.number + MIN_LOCK_BLOCKS)
                throw new Revert('unlockBlock too soon in batch');
        }

        const lockIds = new Array<u64>(count as i32);
        for (let i: i32 = 0; i < (count as i32); i++) {
            TransferHelper.transferFrom(tokens[i], caller, this.address, amounts[i]);
            const lockId = this._nextId();
            this._store(lockId, tokens[i], caller, amounts[i], blocks[i], false, 0);
            lockIds[i] = lockId;
            this.emitEvent(new LockCreatedEvent(lockId, caller, tokens[i], amounts[i], false, blocks[i]));
        }

        this._exit();
        const w = new BytesWriter(4 + (count as i32) * 8);
        w.writeU32(count);
        for (let i: i32 = 0; i < (count as i32); i++) w.writeU64(lockIds[i]);
        return w;
    }

    @method(
        { name: 'lockId',        type: ABIDataTypes.UINT64 },
        { name: 'newUnlockBlock',type: ABIDataTypes.UINT64 },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public extendLock(calldata: Calldata): BytesWriter {
        this._requireActive();

        const lockId   = calldata.readU64();
        const newBlock = calldata.readU64();

        if (this._getBool(lockId, F_PERM)) throw new Revert('permanent lock');
        if (this._getBool(lockId, F_DONE)) throw new Revert('already released');
        if (!Blockchain.tx.sender.equals(this._getAddr(lockId, F_OWNER)))
            throw new Revert('not owner');

        if (newBlock <= this._getU64(lockId, F_BLK)) throw new Revert('must be later');

        this._setU64(lockId, F_BLK, newBlock);
        this._setBool(lockId, F_EXT, true);

        this.emitEvent(new LockExtendedEvent(lockId, newBlock));
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method(
        { name: 'lockId',   type: ABIDataTypes.UINT64  },
        { name: 'newOwner', type: ABIDataTypes.ADDRESS },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public transferLockOwnership(calldata: Calldata): BytesWriter {
        this._requireActive();

        const lockId   = calldata.readU64();
        const newOwner = calldata.readAddress();

        if (this._getBool(lockId, F_PERM)) throw new Revert('permanent lock');
        if (this._getBool(lockId, F_DONE)) throw new Revert('already released');

        const oldOwner = this._getAddr(lockId, F_OWNER);
        if (!Blockchain.tx.sender.equals(oldOwner)) throw new Revert('not owner');
        if (newOwner.equals(Address.zero())) throw new Revert('zero address');

        this._setAddr(lockId, F_OWNER, newOwner);

        // Add to new owner's index
        const oKey = addrToU256(newOwner);
        const oCnt = this._ownCnt.get(oKey);
        this._ownIdx.set(compKey(oKey, oCnt), u256.fromU64(lockId));
        this._ownCnt.set(oKey, SafeMath.add(oCnt, u256.One));

        this.emitEvent(new LockOwnershipTransferredEvent(lockId, oldOwner, newOwner));
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    @method({ name: 'factory', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setFactory(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        this._factory.value = calldata.readAddress();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method({ name: 'paused', type: ABIDataTypes.BOOL })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setPaused(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        this._paused.value = calldata.readBoolean();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method({ name: 'feeSats', type: ABIDataTypes.UINT64 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setFee(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        this._fee.set(0, calldata.readU64());
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method({ name: 'treasury', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public setTreasury(calldata: Calldata): BytesWriter {
        this._requireAdmin();
        this._treasury.value = calldata.readAddress();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method()
    @returns({ name: 'feesCollected', type: ABIDataTypes.UINT256 })
    public withdrawFees(_calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const amount = this._feesCollected.value;
        if (amount.isZero()) throw new Revert('no fees');
        this._feesCollected.value = u256.Zero;
        // Fees are tracked on-chain; BTC disbursement handled via treasury
        const w = new BytesWriter(32); w.writeU256(amount); return w;
    }

    // =========================================================================
    // ── View Methods ──────────────────────────────────────────────────────────
    // =========================================================================

    @method({ name: 'lockId', type: ABIDataTypes.UINT64 })
    @returns(
        { name: 'token',       type: ABIDataTypes.ADDRESS },
        { name: 'owner',       type: ABIDataTypes.ADDRESS },
        { name: 'amount',      type: ABIDataTypes.UINT256 },
        { name: 'unlockBlock', type: ABIDataTypes.UINT64  },
        { name: 'isPermanent', type: ABIDataTypes.BOOL    },
        { name: 'isReleased',  type: ABIDataTypes.BOOL    },
        { name: 'isExtended',  type: ABIDataTypes.BOOL    },
    )
    public getLock(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const w = new BytesWriter(32 + 32 + 32 + 8 + 1 + 1 + 1);
        w.writeAddress(this._getAddr(lockId, F_TOKEN));
        w.writeAddress(this._getAddr(lockId, F_OWNER));
        w.writeU256(this._getField(lockId, F_AMT));
        w.writeU64(this._getU64(lockId, F_BLK));
        w.writeBoolean(this._getBool(lockId, F_PERM));
        w.writeBoolean(this._getBool(lockId, F_DONE));
        w.writeBoolean(this._getBool(lockId, F_EXT));
        return w;
    }

    @method({ name: 'lockId', type: ABIDataTypes.UINT64 })
    @returns(
        { name: 'token',       type: ABIDataTypes.ADDRESS },
        { name: 'owner',       type: ABIDataTypes.ADDRESS },
        { name: 'amount',      type: ABIDataTypes.UINT256 },
        { name: 'unlockBlock', type: ABIDataTypes.UINT64  },
        { name: 'isPermanent', type: ABIDataTypes.BOOL    },
        { name: 'isReleased',  type: ABIDataTypes.BOOL    },
        { name: 'isExtended',  type: ABIDataTypes.BOOL    },
        { name: 'parentId',    type: ABIDataTypes.UINT64  },
        { name: 'splitCount',  type: ABIDataTypes.UINT64  },
    )
    public getLockV2(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const w = new BytesWriter(32 + 32 + 32 + 8 + 1 + 1 + 1 + 8 + 8);
        w.writeAddress(this._getAddr(lockId, F_TOKEN));
        w.writeAddress(this._getAddr(lockId, F_OWNER));
        w.writeU256(this._getField(lockId, F_AMT));
        w.writeU64(this._getU64(lockId, F_BLK));
        w.writeBoolean(this._getBool(lockId, F_PERM));
        w.writeBoolean(this._getBool(lockId, F_DONE));
        w.writeBoolean(this._getBool(lockId, F_EXT));
        w.writeU64(this._getU64(lockId, F_PARENT));
        w.writeU64(this._getU64(lockId, F_SPLITS));
        return w;
    }

    @method(
        { name: 'token',  type: ABIDataTypes.ADDRESS },
        { name: 'offset', type: ABIDataTypes.UINT32  },
        { name: 'limit',  type: ABIDataTypes.UINT32  },
    )
    @returns({ name: 'lockIds', type: ABIDataTypes.UINT64 })
    public getLocksForToken(calldata: Calldata): BytesWriter {
        return this._page(
            addrToU256(calldata.readAddress()),
            this._tknCnt, this._tknIdx,
            calldata.readU32(), calldata.readU32(),
        );
    }

    @method(
        { name: 'owner',  type: ABIDataTypes.ADDRESS },
        { name: 'offset', type: ABIDataTypes.UINT32  },
        { name: 'limit',  type: ABIDataTypes.UINT32  },
    )
    @returns({ name: 'lockIds', type: ABIDataTypes.UINT64 })
    public getLocksForOwner(calldata: Calldata): BytesWriter {
        return this._page(
            addrToU256(calldata.readAddress()),
            this._ownCnt, this._ownIdx,
            calldata.readU32(), calldata.readU32(),
        );
    }

    @method({ name: 'token', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'totalLocked', type: ABIDataTypes.UINT256 })
    public getTotalLocked(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(this._totalLocked.get(addrToU256(calldata.readAddress())));
        return w;
    }

    @method({ name: 'token', type: ABIDataTypes.ADDRESS })
    @returns({ name: 'count', type: ABIDataTypes.UINT64 })
    public getLockCount(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(8);
        w.writeU64(this._tknCnt.get(addrToU256(calldata.readAddress())).lo1);
        return w;
    }

    @method({ name: 'lockId', type: ABIDataTypes.UINT64 })
    @returns({ name: 'isPermanent', type: ABIDataTypes.BOOL })
    public isLockPermanent(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(1);
        w.writeBoolean(this._getBool(calldata.readU64(), F_PERM));
        return w;
    }

    @method({ name: 'lockId', type: ABIDataTypes.UINT64 })
    @returns({ name: 'isUnlockable', type: ABIDataTypes.BOOL })
    public isUnlockable(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const perm   = this._getBool(lockId, F_PERM);
        const done   = this._getBool(lockId, F_DONE);
        const blk    = this._getU64(lockId, F_BLK);
        const w = new BytesWriter(1);
        w.writeBoolean(!perm && !done && blk > 0 && Blockchain.block.number >= blk);
        return w;
    }

    @method()
    @returns({ name: 'version', type: ABIDataTypes.STRING })
    public version(_: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeStringWithLength('3.0.0-testnet');
        return w;
    }

    @method()
    @returns({ name: 'paused', type: ABIDataTypes.BOOL })
    public isPaused(_: Calldata): BytesWriter {
        const w = new BytesWriter(1);
        w.writeBoolean(this._paused.value);
        return w;
    }

    @method()
    @returns({ name: 'fee', type: ABIDataTypes.UINT64 })
    public getFee(_: Calldata): BytesWriter {
        const w = new BytesWriter(8);
        w.writeU64(this._fee.get(0));
        return w;
    }

    @method()
    @returns({ name: 'treasury', type: ABIDataTypes.ADDRESS })
    public getTreasury(_: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeAddress(this._treasury.value);
        return w;
    }

    @method()
    @returns({ name: 'feesCollected', type: ABIDataTypes.UINT256 })
    public getFeesCollected(_: Calldata): BytesWriter {
        const w = new BytesWriter(32);
        w.writeU256(this._feesCollected.value);
        return w;
    }

    // =========================================================================
    // ── Private Helpers ───────────────────────────────────────────────────────
    // =========================================================================

    private _enter(): void {
        if (this._reentrancy.value) throw new Revert('reentrancy');
        this._reentrancy.value = true;
    }

    private _exit(): void {
        this._reentrancy.value = false;
    }

    private _requireActive(): void {
        if (this._paused.value) throw new Revert('paused');
    }

    private _requireAdmin(): void {
        if (!Blockchain.tx.sender.equals(this._admin.value))
            throw new Revert('admin only');
    }

    private _collectFee(): void {
        const fee = this._fee.get(0);
        if (fee == 0) return;
        this._feesCollected.value = SafeMath.add(this._feesCollected.value, u256.fromU64(fee));
    }

    private _nextId(): u64 {
        const n = this._lockCounter.get(0) + 1;
        this._lockCounter.set(0, n);
        return n;
    }

    private _store(
        id: u64, token: Address, owner: Address,
        amount: u256, blk: u64, perm: bool, parentId: u64,
    ): void {
        this._setField(id, F_AMT, amount);
        this._setAddr(id, F_TOKEN, token);
        this._setAddr(id, F_OWNER, owner);
        this._setU64(id, F_BLK, blk);
        this._setBool(id, F_PERM, perm);
        this._setBool(id, F_DONE, false);
        this._setBool(id, F_EXT, false);
        this._setU64(id, F_SPLITS, 0);
        this._setU64(id, F_PARENT, parentId);

        // Token index
        const tKey = addrToU256(token);
        const tCnt = this._tknCnt.get(tKey);
        this._tknIdx.set(compKey(tKey, tCnt), u256.fromU64(id));
        this._tknCnt.set(tKey, SafeMath.add(tCnt, u256.One));

        // Owner index
        const oKey = addrToU256(owner);
        const oCnt = this._ownCnt.get(oKey);
        this._ownIdx.set(compKey(oKey, oCnt), u256.fromU64(id));
        this._ownCnt.set(oKey, SafeMath.add(oCnt, u256.One));

        // Total locked
        this._totalLocked.set(tKey, SafeMath.add(this._totalLocked.get(tKey), amount));
    }

    // ── Field read/write shortcuts ────────────────────────────────────────────

    private _getField(id: u64, field: u256): u256 {
        return this._lockData.get(lockKey(id, field));
    }

    private _setField(id: u64, field: u256, val: u256): void {
        this._lockData.set(lockKey(id, field), val);
    }

    private _getBool(id: u64, field: u256): bool {
        return !this._getField(id, field).isZero();
    }

    private _setBool(id: u64, field: u256, val: bool): void {
        this._setField(id, field, val ? u256.One : u256.Zero);
    }

    private _getU64(id: u64, field: u256): u64 {
        return this._getField(id, field).lo1;
    }

    private _setU64(id: u64, field: u256, val: u64): void {
        this._setField(id, field, u256.fromU64(val));
    }

    private _getAddr(id: u64, field: u256): Address {
        return u256ToAddr(this._getField(id, field));
    }

    private _setAddr(id: u64, field: u256, addr: Address): void {
        this._setField(id, field, addrToU256(addr));
    }

    // ── Paginated index reader ────────────────────────────────────────────────

    private _page(
        scopeKey: u256,
        cntMap: StoredMapU256, idxMap: StoredMapU256,
        off: u32, lim: u32,
    ): BytesWriter {
        const total   = cntMap.get(scopeKey).lo1;
        const safe    = lim > MAX_PAGE ? MAX_PAGE : lim;
        const start   = off as u64;
        const end     = start + (safe as u64);
        const realEnd = end > total ? total : end;
        const count   = realEnd > start ? (realEnd - start) as u32 : 0;
        const w = new BytesWriter(4 + (count as i32) * 8);
        w.writeU32(count);
        for (let i: u64 = start; i < realEnd; i++) {
            w.writeU64(idxMap.get(compKey(scopeKey, u256.fromU64(i))).lo1);
        }
        return w;
    }
}
