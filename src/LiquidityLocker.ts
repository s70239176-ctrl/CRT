import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    Address,
    Blockchain,
    BytesWriter,
    Calldata,
    EMPTY_POINTER,
    NetEvent,
    OP20,
    OP20InitParameters,
    Revert,
    SafeMath,
    StoredAddress,
    StoredBoolean,
    StoredMapU256,
    StoredU256,
    StoredU64,
    TransferHelper,
} from '@btc-vision/btc-runtime/runtime';

const MIN_LOCK_BLOCKS: u64 = 1;
const DEFAULT_FEE_SATS: u64 = 0;
const MAX_BATCH: u32 = 10;
const MAX_PAGE: u32 = 50;
const MAX_LABEL: i32 = 64;

const F_AMT:    u256 = u256.fromU32(1);
const F_TOKEN:  u256 = u256.fromU32(2);
const F_OWNER:  u256 = u256.fromU32(3);
const F_BLK:    u256 = u256.fromU32(4);
const F_PERM:   u256 = u256.fromU32(5);
const F_DONE:   u256 = u256.fromU32(6);
const F_EXT:    u256 = u256.fromU32(7);
const F_SPLITS: u256 = u256.fromU32(8);
const F_PARENT: u256 = u256.fromU32(9);

@final
class LockCreatedEvent extends NetEvent {
    constructor(lockId: u64, caller: Address, token: Address, amount: u256, perm: bool, unlockBlock: u64) {
        const data = new BytesWriter(8 + 32 + 32 + 32 + 1 + 8);
        data.writeU64(lockId); data.writeAddress(caller); data.writeAddress(token);
        data.writeU256(amount); data.writeBoolean(perm); data.writeU64(unlockBlock);
        super('LockCreated', data);
    }
}
@final
class LockReleasedEvent extends NetEvent {
    constructor(lockId: u64, owner: Address, token: Address, amount: u256) {
        const data = new BytesWriter(8 + 32 + 32 + 32);
        data.writeU64(lockId); data.writeAddress(owner); data.writeAddress(token); data.writeU256(amount);
        super('LockReleased', data);
    }
}
@final
class LockSplitEvent extends NetEvent {
    constructor(parentId: u64, childId: u64, splitAmount: u256, remaining: u256) {
        const data = new BytesWriter(8 + 8 + 32 + 32);
        data.writeU64(parentId); data.writeU64(childId); data.writeU256(splitAmount); data.writeU256(remaining);
        super('LockSplit', data);
    }
}
@final
class LockExtendedEvent extends NetEvent {
    constructor(lockId: u64, newBlock: u64) {
        const data = new BytesWriter(16);
        data.writeU64(lockId); data.writeU64(newBlock);
        super('LockExtended', data);
    }
}
@final
class LockOwnershipTransferredEvent extends NetEvent {
    constructor(lockId: u64, oldOwner: Address, newOwner: Address) {
        const data = new BytesWriter(8 + 32 + 32);
        data.writeU64(lockId); data.writeAddress(oldOwner); data.writeAddress(newOwner);
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

@inline
function compKey(a: u256, b: u256): u256 {
    const buf = new Uint8Array(64);
    const aB = a.toUint8Array(true);
    const bB = b.toUint8Array(true);
    for (let i = 0; i < 32; i++) buf[i]      = i < aB.length ? aB[aB.length - 32 + i] : 0;
    for (let i = 0; i < 32; i++) buf[32 + i]  = i < bB.length ? bB[bB.length - 32 + i] : 0;
    return u256.fromBytes(Blockchain.sha256(buf));
}
@inline
function lockKey(lockId: u64, field: u256): u256 { return compKey(u256.fromU64(lockId), field); }
@inline
function addrToU256(addr: Address): u256 {
    const buf = new Uint8Array(32);
    memory.copy(changetype<usize>(buf.buffer), changetype<usize>(addr.buffer), 32);
    return u256.fromBytes(buf);
}
@inline
function u256ToAddr(v: u256): Address {
    const b = v.toUint8Array(true);
    const p = new Uint8Array(32);
    for (let i = 0; i < 32; i++) p[i] = i < b.length ? b[b.length - 32 + i] : 0;
    return Address.fromUint8Array(p);
}

@final
export class LiquidityLocker extends OP20 {
    private readonly _adminPtr:       u16 = Blockchain.nextPointer;
    private readonly _pausedPtr:      u16 = Blockchain.nextPointer;
    private readonly _rentPtr:        u16 = Blockchain.nextPointer;
    private readonly _feePtr:         u16 = Blockchain.nextPointer;
    private readonly _ctrPtr:         u16 = Blockchain.nextPointer;
    private readonly _feesColPtr:     u16 = Blockchain.nextPointer;
    private readonly _treasPtr:       u16 = Blockchain.nextPointer;
    private readonly _factPtr:        u16 = Blockchain.nextPointer;
    private readonly _lockDataPtr:    u16 = Blockchain.nextPointer;
    private readonly _tknCntPtr:      u16 = Blockchain.nextPointer;
    private readonly _tknIdxPtr:      u16 = Blockchain.nextPointer;
    private readonly _ownCntPtr:      u16 = Blockchain.nextPointer;
    private readonly _ownIdxPtr:      u16 = Blockchain.nextPointer;
    private readonly _totalLockedPtr: u16 = Blockchain.nextPointer;

    private _admin:         StoredAddress  = new StoredAddress(this._adminPtr);
    private _paused:        StoredBoolean  = new StoredBoolean(this._pausedPtr, false);
    private _reentrancy:    StoredBoolean  = new StoredBoolean(this._rentPtr, false);
    private _fee:           StoredU64      = new StoredU64(this._feePtr, EMPTY_POINTER);
    private _lockCounter:   StoredU64      = new StoredU64(this._ctrPtr, EMPTY_POINTER);
    private _feesCollected: StoredU256     = new StoredU256(this._feesColPtr, EMPTY_POINTER);
    private _treasury:      StoredAddress  = new StoredAddress(this._treasPtr);
    private _factory:       StoredAddress  = new StoredAddress(this._factPtr);
    private _lockData:      StoredMapU256  = new StoredMapU256(this._lockDataPtr);
    private _tknCnt:        StoredMapU256  = new StoredMapU256(this._tknCntPtr);
    private _tknIdx:        StoredMapU256  = new StoredMapU256(this._tknIdxPtr);
    private _ownCnt:        StoredMapU256  = new StoredMapU256(this._ownCntPtr);
    private _ownIdx:        StoredMapU256  = new StoredMapU256(this._ownIdxPtr);
    private _totalLocked:   StoredMapU256  = new StoredMapU256(this._totalLockedPtr);

    public constructor() { super(); }

    public override onDeployment(_calldata: Calldata): void {
        this.instantiate(new OP20InitParameters(u256.Zero, 0, 'MotoSwap Liquidity Locker', 'MLOCK'));
        const deployer = Blockchain.tx.sender;
        this._admin.value    = deployer;
        this._treasury.value = deployer;
        this._paused.value   = false;
        this._fee.set(0, DEFAULT_FEE_SATS);
        this.emitEvent(new ContractDeployedEvent(deployer));
    }

    @method({ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'label', type: 'string' }, { name: 'tag', type: 'string' })
    @returns({ name: 'lockId', type: 'uint64' })
    @emit('LockCreated')
    public lockPermanent(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter(); this._collectFee();
        const token = calldata.readAddress(); const amount = calldata.readU256();
        const label = calldata.readStringWithLength(); calldata.readStringWithLength();
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

    @method({ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'unlockBlock', type: 'uint64' }, { name: 'label', type: 'string' }, { name: 'tag', type: 'string' })
    @returns({ name: 'lockId', type: 'uint64' })
    @emit('LockCreated')
    public lockTimed(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter(); this._collectFee();
        const token = calldata.readAddress(); const amount = calldata.readU256();
        const unlockBlock = calldata.readU64();
        const label = calldata.readStringWithLength(); calldata.readStringWithLength();
        if (amount.isZero()) throw new Revert('zero amount');
        if (label.length > MAX_LABEL) throw new Revert('label too long');
        if (unlockBlock <= Blockchain.block.number + MIN_LOCK_BLOCKS) throw new Revert('unlockBlock too soon');
        const caller = Blockchain.tx.sender;
        TransferHelper.transferFrom(token, caller, this.address, amount);
        const lockId = this._nextId();
        this._store(lockId, token, caller, amount, unlockBlock, false, 0);
        this.emitEvent(new LockCreatedEvent(lockId, caller, token, amount, false, unlockBlock));
        this._exit();
        const w = new BytesWriter(8); w.writeU64(lockId); return w;
    }

    @method({ name: 'lockId', type: 'uint64' })
    @returns({ name: 'success', type: 'bool' })
    @emit('LockReleased')
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
        const token = this._getAddr(lockId, F_TOKEN); const amount = this._getField(lockId, F_AMT);
        this._setBool(lockId, F_DONE, true);
        const tKey = addrToU256(token);
        this._totalLocked.set(tKey, SafeMath.sub(this._totalLocked.get(tKey), amount));
        TransferHelper.transfer(token, owner, amount);
        this.emitEvent(new LockReleasedEvent(lockId, owner, token, amount));
        this._exit();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method({ name: 'lockId', type: 'uint64' }, { name: 'partial', type: 'uint256' })
    @returns({ name: 'success', type: 'bool' })
    public unlockPartial(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter();
        const lockId = calldata.readU64(); const partial = calldata.readU256();
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
        this._setField(lockId, F_AMT, SafeMath.sub(current, partial));
        const tKey = addrToU256(token);
        this._totalLocked.set(tKey, SafeMath.sub(this._totalLocked.get(tKey), partial));
        TransferHelper.transfer(token, owner, partial);
        this._exit();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method({ name: 'lockId', type: 'uint64' }, { name: 'splitAmount', type: 'uint256' })
    @returns({ name: 'childLockId', type: 'uint64' })
    @emit('LockSplit')
    public splitLock(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter();
        const lockId = calldata.readU64(); const splitAmount = calldata.readU256();
        if (this._getBool(lockId, F_PERM)) throw new Revert('cannot split permanent');
        if (this._getBool(lockId, F_DONE)) throw new Revert('already released');
        if (splitAmount.isZero()) throw new Revert('zero split');
        const owner = this._getAddr(lockId, F_OWNER);
        if (!Blockchain.tx.sender.equals(owner)) throw new Revert('not owner');
        const current = this._getField(lockId, F_AMT);
        if (splitAmount >= current) throw new Revert('split >= total');
        const token = this._getAddr(lockId, F_TOKEN); const unlockBlock = this._getU64(lockId, F_BLK);
        const remaining = SafeMath.sub(current, splitAmount);
        this._setField(lockId, F_AMT, remaining);
        this._setU64(lockId, F_SPLITS, this._getU64(lockId, F_SPLITS) + 1);
        const childId = this._nextId();
        this._store(childId, token, owner, splitAmount, unlockBlock, false, lockId);
        this.emitEvent(new LockSplitEvent(lockId, childId, splitAmount, remaining));
        this._exit();
        const w = new BytesWriter(8); w.writeU64(childId); return w;
    }

    @method({ name: 'count', type: 'uint32' }, { name: 'tokens', type: 'address' }, { name: 'amounts', type: 'uint256' }, { name: 'unlockBlocks', type: 'uint64' }, { name: 'labels', type: 'string' })
    @returns({ name: 'lockIds', type: 'uint64' })
    public batchLockTimed(calldata: Calldata): BytesWriter {
        this._requireActive(); this._enter(); this._collectFee();
        const count = calldata.readU32();
        if (count == 0) throw new Revert('empty batch');
        if (count > MAX_BATCH) throw new Revert('batch too large');
        const caller = Blockchain.tx.sender;
        const tokens  = new Array<Address>(count as i32);
        const amounts = new Array<u256>(count as i32);
        const blocks  = new Array<u64>(count as i32);
        const labels  = new Array<string>(count as i32);
        for (let i: i32 = 0; i < (count as i32); i++) tokens[i]  = calldata.readAddress();
        for (let i: i32 = 0; i < (count as i32); i++) amounts[i] = calldata.readU256();
        for (let i: i32 = 0; i < (count as i32); i++) blocks[i]  = calldata.readU64();
        for (let i: i32 = 0; i < (count as i32); i++) labels[i]  = calldata.readStringWithLength();
        for (let i: i32 = 0; i < (count as i32); i++) {
            if (amounts[i].isZero()) throw new Revert('zero amount in batch');
            if (blocks[i] <= Blockchain.block.number + MIN_LOCK_BLOCKS) throw new Revert('block too soon');
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
        const w = new BytesWriter(4 + (count as i32) * 8); w.writeU32(count);
        for (let i: i32 = 0; i < (count as i32); i++) w.writeU64(lockIds[i]);
        return w;
    }

    @method({ name: 'lockId', type: 'uint64' }, { name: 'newUnlockBlock', type: 'uint64' })
    @returns({ name: 'success', type: 'bool' })
    @emit('LockExtended')
    public extendLock(calldata: Calldata): BytesWriter {
        this._requireActive();
        const lockId = calldata.readU64(); const newBlock = calldata.readU64();
        if (this._getBool(lockId, F_PERM)) throw new Revert('permanent lock');
        if (this._getBool(lockId, F_DONE)) throw new Revert('already released');
        if (!Blockchain.tx.sender.equals(this._getAddr(lockId, F_OWNER))) throw new Revert('not owner');
        if (newBlock <= this._getU64(lockId, F_BLK)) throw new Revert('must be later');
        this._setU64(lockId, F_BLK, newBlock);
        this._setBool(lockId, F_EXT, true);
        this.emitEvent(new LockExtendedEvent(lockId, newBlock));
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method({ name: 'lockId', type: 'uint64' }, { name: 'newOwner', type: 'address' })
    @returns({ name: 'success', type: 'bool' })
    @emit('LockOwnershipTransferred')
    public transferLockOwnership(calldata: Calldata): BytesWriter {
        this._requireActive();
        const lockId = calldata.readU64(); const newOwner = calldata.readAddress();
        if (this._getBool(lockId, F_PERM)) throw new Revert('permanent lock');
        if (this._getBool(lockId, F_DONE)) throw new Revert('already released');
        const oldOwner = this._getAddr(lockId, F_OWNER);
        if (!Blockchain.tx.sender.equals(oldOwner)) throw new Revert('not owner');
        if (newOwner.equals(Address.zero())) throw new Revert('zero address');
        this._setAddr(lockId, F_OWNER, newOwner);
        const oKey = addrToU256(newOwner); const oCnt = this._ownCnt.get(oKey);
        this._ownIdx.set(compKey(oKey, oCnt), u256.fromU64(lockId));
        this._ownCnt.set(oKey, SafeMath.add(oCnt, u256.One));
        this.emitEvent(new LockOwnershipTransferredEvent(lockId, oldOwner, newOwner));
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }

    @method({ name: 'factory', type: 'address' }) @returns({ name: 'success', type: 'bool' })
    public setFactory(calldata: Calldata): BytesWriter {
        this._requireAdmin(); this._factory.value = calldata.readAddress();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }
    @method({ name: 'paused', type: 'bool' }) @returns({ name: 'success', type: 'bool' })
    public setPaused(calldata: Calldata): BytesWriter {
        this._requireAdmin(); this._paused.value = calldata.readBoolean();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }
    @method({ name: 'feeSats', type: 'uint64' }) @returns({ name: 'success', type: 'bool' })
    public setFee(calldata: Calldata): BytesWriter {
        this._requireAdmin(); this._fee.set(0, calldata.readU64());
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }
    @method({ name: 'treasury', type: 'address' }) @returns({ name: 'success', type: 'bool' })
    public setTreasury(calldata: Calldata): BytesWriter {
        this._requireAdmin(); this._treasury.value = calldata.readAddress();
        const w = new BytesWriter(1); w.writeBoolean(true); return w;
    }
    @method() @returns({ name: 'feesCleared', type: 'uint256' })
    public withdrawFees(_calldata: Calldata): BytesWriter {
        this._requireAdmin();
        const amount = this._feesCollected.value;
        if (amount.isZero()) throw new Revert('no fees');
        this._feesCollected.value = u256.Zero;
        const w = new BytesWriter(32); w.writeU256(amount); return w;
    }

    @method({ name: 'lockId', type: 'uint64' })
    @returns({ name: 'token', type: 'address' }, { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'unlockBlock', type: 'uint64' }, { name: 'isPermanent', type: 'bool' }, { name: 'isReleased', type: 'bool' }, { name: 'isExtended', type: 'bool' }, { name: 'parentId', type: 'uint64' }, { name: 'splitCount', type: 'uint64' })
    public getLock(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const w = new BytesWriter(32 + 32 + 32 + 8 + 1 + 1 + 1 + 8 + 8);
        w.writeAddress(this._getAddr(lockId, F_TOKEN)); w.writeAddress(this._getAddr(lockId, F_OWNER));
        w.writeU256(this._getField(lockId, F_AMT)); w.writeU64(this._getU64(lockId, F_BLK));
        w.writeBoolean(this._getBool(lockId, F_PERM)); w.writeBoolean(this._getBool(lockId, F_DONE));
        w.writeBoolean(this._getBool(lockId, F_EXT)); w.writeU64(this._getU64(lockId, F_PARENT));
        w.writeU64(this._getU64(lockId, F_SPLITS)); return w;
    }

    @method({ name: 'lockId', type: 'uint64' })
    @returns({ name: 'token', type: 'address' }, { name: 'owner', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'unlockBlock', type: 'uint64' }, { name: 'isPermanent', type: 'bool' }, { name: 'isReleased', type: 'bool' }, { name: 'isExtended', type: 'bool' }, { name: 'parentId', type: 'uint64' }, { name: 'splitCount', type: 'uint64' })
    public getLockV2(calldata: Calldata): BytesWriter { return this.getLock(calldata); }

    @method({ name: 'token', type: 'address' }, { name: 'offset', type: 'uint32' }, { name: 'limit', type: 'uint32' })
    @returns({ name: 'lockIds', type: 'uint64' })
    public getLocksForToken(calldata: Calldata): BytesWriter {
        return this._page(addrToU256(calldata.readAddress()), this._tknCnt, this._tknIdx, calldata.readU32(), calldata.readU32());
    }
    @method({ name: 'owner', type: 'address' }, { name: 'offset', type: 'uint32' }, { name: 'limit', type: 'uint32' })
    @returns({ name: 'lockIds', type: 'uint64' })
    public getLocksForOwner(calldata: Calldata): BytesWriter {
        return this._page(addrToU256(calldata.readAddress()), this._ownCnt, this._ownIdx, calldata.readU32(), calldata.readU32());
    }
    @method({ name: 'token', type: 'address' }) @returns({ name: 'total', type: 'uint256' })
    public getTotalLocked(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(32); w.writeU256(this._totalLocked.get(addrToU256(calldata.readAddress()))); return w;
    }
    @method({ name: 'token', type: 'address' }) @returns({ name: 'count', type: 'uint64' })
    public getLockCount(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(8); w.writeU64(this._tknCnt.get(addrToU256(calldata.readAddress())).lo1); return w;
    }
    @method({ name: 'lockId', type: 'uint64' }) @returns({ name: 'isPermanent', type: 'bool' })
    public isLockPermanent(calldata: Calldata): BytesWriter {
        const w = new BytesWriter(1); w.writeBoolean(this._getBool(calldata.readU64(), F_PERM)); return w;
    }
    @method({ name: 'lockId', type: 'uint64' }) @returns({ name: 'unlockable', type: 'bool' })
    public isUnlockable(calldata: Calldata): BytesWriter {
        const lockId = calldata.readU64();
        const blk = this._getU64(lockId, F_BLK);
        const w = new BytesWriter(1);
        w.writeBoolean(!this._getBool(lockId, F_PERM) && !this._getBool(lockId, F_DONE) && blk > 0 && Blockchain.block.number >= blk);
        return w;
    }
    @method() @returns({ name: 'version', type: 'string' })
    public version(_: Calldata): BytesWriter { const w = new BytesWriter(32); w.writeStringWithLength('3.0.0-testnet'); return w; }
    @method() @returns({ name: 'paused', type: 'bool' })
    public isPaused(_: Calldata): BytesWriter { const w = new BytesWriter(1); w.writeBoolean(this._paused.value); return w; }
    @method() @returns({ name: 'fee', type: 'uint64' })
    public getFee(_: Calldata): BytesWriter { const w = new BytesWriter(8); w.writeU64(this._fee.get(0)); return w; }
    @method() @returns({ name: 'treasury', type: 'address' })
    public getTreasury(_: Calldata): BytesWriter { const w = new BytesWriter(32); w.writeAddress(this._treasury.value); return w; }
    @method() @returns({ name: 'feesCollected', type: 'uint256' })
    public getFeesCollected(_: Calldata): BytesWriter { const w = new BytesWriter(32); w.writeU256(this._feesCollected.value); return w; }

    private _enter(): void { if (this._reentrancy.value) throw new Revert('reentrancy'); this._reentrancy.value = true; }
    private _exit(): void { this._reentrancy.value = false; }
    private _requireActive(): void { if (this._paused.value) throw new Revert('paused'); }
    private _requireAdmin(): void { if (!Blockchain.tx.sender.equals(this._admin.value)) throw new Revert('admin only'); }
    private _collectFee(): void {
        const fee = this._fee.get(0); if (fee == 0) return;
        this._feesCollected.value = SafeMath.add(this._feesCollected.value, u256.fromU64(fee));
    }
    private _nextId(): u64 { const n = this._lockCounter.get(0) + 1; this._lockCounter.set(0, n); return n; }
    private _store(id: u64, token: Address, owner: Address, amount: u256, blk: u64, perm: bool, parentId: u64): void {
        this._setField(id, F_AMT, amount); this._setAddr(id, F_TOKEN, token); this._setAddr(id, F_OWNER, owner);
        this._setU64(id, F_BLK, blk); this._setBool(id, F_PERM, perm);
        this._setBool(id, F_DONE, false); this._setBool(id, F_EXT, false);
        this._setU64(id, F_SPLITS, 0); this._setU64(id, F_PARENT, parentId);
        const tKey = addrToU256(token); const tCnt = this._tknCnt.get(tKey);
        this._tknIdx.set(compKey(tKey, tCnt), u256.fromU64(id));
        this._tknCnt.set(tKey, SafeMath.add(tCnt, u256.One));
        const oKey = addrToU256(owner); const oCnt = this._ownCnt.get(oKey);
        this._ownIdx.set(compKey(oKey, oCnt), u256.fromU64(id));
        this._ownCnt.set(oKey, SafeMath.add(oCnt, u256.One));
        this._totalLocked.set(tKey, SafeMath.add(this._totalLocked.get(tKey), amount));
    }
    private _getField(id: u64, field: u256): u256 { return this._lockData.get(lockKey(id, field)); }
    private _setField(id: u64, field: u256, val: u256): void { this._lockData.set(lockKey(id, field), val); }
    private _getBool(id: u64, field: u256): bool { return !this._getField(id, field).isZero(); }
    private _setBool(id: u64, field: u256, val: bool): void { this._setField(id, field, val ? u256.One : u256.Zero); }
    private _getU64(id: u64, field: u256): u64 { return this._getField(id, field).lo1; }
    private _setU64(id: u64, field: u256, val: u64): void { this._setField(id, field, u256.fromU64(val)); }
    private _getAddr(id: u64, field: u256): Address { return u256ToAddr(this._getField(id, field)); }
    private _setAddr(id: u64, field: u256, addr: Address): void { this._setField(id, field, addrToU256(addr)); }
    private _page(scopeKey: u256, cntMap: StoredMapU256, idxMap: StoredMapU256, off: u32, lim: u32): BytesWriter {
        const total = cntMap.get(scopeKey).lo1; const safe = lim > MAX_PAGE ? MAX_PAGE : lim;
        const start = off as u64; const end = start + (safe as u64);
        const realEnd = end > total ? total : end;
        const count = realEnd > start ? (realEnd - start) as u32 : 0;
        const w = new BytesWriter(4 + (count as i32) * 8); w.writeU32(count);
        for (let i: u64 = start; i < realEnd; i++) w.writeU64(idxMap.get(compKey(scopeKey, u256.fromU64(i))).lo1);
        return w;
    }
}
