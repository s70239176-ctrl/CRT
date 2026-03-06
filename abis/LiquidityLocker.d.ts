import { Address, AddressMap, ExtendedAddressMap, SchnorrSignature } from '@btc-vision/transaction';
import { CallResult, OPNetEvent, IOP_NETContract } from 'opnet';

// ------------------------------------------------------------------
// Event Definitions
// ------------------------------------------------------------------
export type LockCreatedEvent = {
    readonly lockId: bigint;
    readonly caller: Address;
    readonly token: Address;
    readonly amount: bigint;
    readonly perm: boolean;
    readonly unlockBlock: bigint;
};
export type LockReleasedEvent = {
    readonly lockId: bigint;
    readonly owner: Address;
    readonly token: Address;
    readonly amount: bigint;
};
export type LockSplitEvent = {
    readonly parentId: bigint;
    readonly childId: bigint;
    readonly splitAmount: bigint;
    readonly remaining: bigint;
};
export type LockExtendedEvent = {
    readonly lockId: bigint;
    readonly newBlock: bigint;
};
export type LockOwnershipTransferredEvent = {
    readonly lockId: bigint;
    readonly oldOwner: Address;
    readonly newOwner: Address;
};

// ------------------------------------------------------------------
// Call Results
// ------------------------------------------------------------------

/**
 * @description Represents the result of the lockPermanent function call.
 */
export type LockPermanent = CallResult<
    {
        lockId: bigint;
    },
    OPNetEvent<LockCreatedEvent>[]
>;

/**
 * @description Represents the result of the lockTimed function call.
 */
export type LockTimed = CallResult<
    {
        lockId: bigint;
    },
    OPNetEvent<LockCreatedEvent>[]
>;

/**
 * @description Represents the result of the unlock function call.
 */
export type Unlock = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<LockReleasedEvent>[]
>;

/**
 * @description Represents the result of the unlockPartial function call.
 */
export type UnlockPartial = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the splitLock function call.
 */
export type SplitLock = CallResult<
    {
        childLockId: bigint;
    },
    OPNetEvent<LockSplitEvent>[]
>;

/**
 * @description Represents the result of the batchLockTimed function call.
 */
export type BatchLockTimed = CallResult<
    {
        lockIds: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the extendLock function call.
 */
export type ExtendLock = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<LockExtendedEvent>[]
>;

/**
 * @description Represents the result of the transferLockOwnership function call.
 */
export type TransferLockOwnership = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<LockOwnershipTransferredEvent>[]
>;

/**
 * @description Represents the result of the setFactory function call.
 */
export type SetFactory = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setPaused function call.
 */
export type SetPaused = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setFee function call.
 */
export type SetFee = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the setTreasury function call.
 */
export type SetTreasury = CallResult<
    {
        success: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the withdrawFees function call.
 */
export type WithdrawFees = CallResult<
    {
        feesCleared: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getLock function call.
 */
export type GetLock = CallResult<
    {
        token: Address;
        owner: Address;
        amount: bigint;
        unlockBlock: bigint;
        isPermanent: boolean;
        isReleased: boolean;
        isExtended: boolean;
        parentId: bigint;
        splitCount: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getLockV2 function call.
 */
export type GetLockV2 = CallResult<
    {
        token: Address;
        owner: Address;
        amount: bigint;
        unlockBlock: bigint;
        isPermanent: boolean;
        isReleased: boolean;
        isExtended: boolean;
        parentId: bigint;
        splitCount: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getLocksForToken function call.
 */
export type GetLocksForToken = CallResult<
    {
        lockIds: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getLocksForOwner function call.
 */
export type GetLocksForOwner = CallResult<
    {
        lockIds: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getTotalLocked function call.
 */
export type GetTotalLocked = CallResult<
    {
        total: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getLockCount function call.
 */
export type GetLockCount = CallResult<
    {
        count: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the isLockPermanent function call.
 */
export type IsLockPermanent = CallResult<
    {
        isPermanent: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the isUnlockable function call.
 */
export type IsUnlockable = CallResult<
    {
        unlockable: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the version function call.
 */
export type Version = CallResult<
    {
        version: string;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the isPaused function call.
 */
export type IsPaused = CallResult<
    {
        paused: boolean;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getFee function call.
 */
export type GetFee = CallResult<
    {
        fee: bigint;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getTreasury function call.
 */
export type GetTreasury = CallResult<
    {
        treasury: Address;
    },
    OPNetEvent<never>[]
>;

/**
 * @description Represents the result of the getFeesCollected function call.
 */
export type GetFeesCollected = CallResult<
    {
        feesCollected: bigint;
    },
    OPNetEvent<never>[]
>;

// ------------------------------------------------------------------
// ILiquidityLocker
// ------------------------------------------------------------------
export interface ILiquidityLocker extends IOP_NETContract {
    lockPermanent(token: Address, amount: bigint, label: string, tag: string): Promise<LockPermanent>;
    lockTimed(token: Address, amount: bigint, unlockBlock: bigint, label: string, tag: string): Promise<LockTimed>;
    unlock(lockId: bigint): Promise<Unlock>;
    unlockPartial(lockId: bigint, partial: bigint): Promise<UnlockPartial>;
    splitLock(lockId: bigint, splitAmount: bigint): Promise<SplitLock>;
    batchLockTimed(
        count: number,
        tokens: Address,
        amounts: bigint,
        unlockBlocks: bigint,
        labels: string,
    ): Promise<BatchLockTimed>;
    extendLock(lockId: bigint, newUnlockBlock: bigint): Promise<ExtendLock>;
    transferLockOwnership(lockId: bigint, newOwner: Address): Promise<TransferLockOwnership>;
    setFactory(factory: Address): Promise<SetFactory>;
    setPaused(paused: boolean): Promise<SetPaused>;
    setFee(feeSats: bigint): Promise<SetFee>;
    setTreasury(treasury: Address): Promise<SetTreasury>;
    withdrawFees(): Promise<WithdrawFees>;
    getLock(lockId: bigint): Promise<GetLock>;
    getLockV2(lockId: bigint): Promise<GetLockV2>;
    getLocksForToken(token: Address, offset: number, limit: number): Promise<GetLocksForToken>;
    getLocksForOwner(owner: Address, offset: number, limit: number): Promise<GetLocksForOwner>;
    getTotalLocked(token: Address): Promise<GetTotalLocked>;
    getLockCount(token: Address): Promise<GetLockCount>;
    isLockPermanent(lockId: bigint): Promise<IsLockPermanent>;
    isUnlockable(lockId: bigint): Promise<IsUnlockable>;
    version(): Promise<Version>;
    isPaused(): Promise<IsPaused>;
    getFee(): Promise<GetFee>;
    getTreasury(): Promise<GetTreasury>;
    getFeesCollected(): Promise<GetFeesCollected>;
}
