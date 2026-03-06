import { ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';

export const LiquidityLockerEvents = [
    {
        name: 'LockCreated',
        values: [
            { name: 'lockId', type: ABIDataTypes.UINT64 },
            { name: 'caller', type: ABIDataTypes.ADDRESS },
            { name: 'token', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
            { name: 'perm', type: ABIDataTypes.BOOL },
            { name: 'unlockBlock', type: ABIDataTypes.UINT64 },
        ],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'LockReleased',
        values: [
            { name: 'lockId', type: ABIDataTypes.UINT64 },
            { name: 'owner', type: ABIDataTypes.ADDRESS },
            { name: 'token', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
        ],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'LockSplit',
        values: [
            { name: 'parentId', type: ABIDataTypes.UINT64 },
            { name: 'childId', type: ABIDataTypes.UINT64 },
            { name: 'splitAmount', type: ABIDataTypes.UINT256 },
            { name: 'remaining', type: ABIDataTypes.UINT256 },
        ],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'LockExtended',
        values: [
            { name: 'lockId', type: ABIDataTypes.UINT64 },
            { name: 'newBlock', type: ABIDataTypes.UINT64 },
        ],
        type: BitcoinAbiTypes.Event,
    },
    {
        name: 'LockOwnershipTransferred',
        values: [
            { name: 'lockId', type: ABIDataTypes.UINT64 },
            { name: 'oldOwner', type: ABIDataTypes.ADDRESS },
            { name: 'newOwner', type: ABIDataTypes.ADDRESS },
        ],
        type: BitcoinAbiTypes.Event,
    },
];

export const LiquidityLockerAbi = [
    {
        name: 'lockPermanent',
        inputs: [
            { name: 'token', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
            { name: 'label', type: ABIDataTypes.STRING },
            { name: 'tag', type: ABIDataTypes.STRING },
        ],
        outputs: [{ name: 'lockId', type: ABIDataTypes.UINT64 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'lockTimed',
        inputs: [
            { name: 'token', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
            { name: 'unlockBlock', type: ABIDataTypes.UINT64 },
            { name: 'label', type: ABIDataTypes.STRING },
            { name: 'tag', type: ABIDataTypes.STRING },
        ],
        outputs: [{ name: 'lockId', type: ABIDataTypes.UINT64 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'unlock',
        inputs: [{ name: 'lockId', type: ABIDataTypes.UINT64 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'unlockPartial',
        inputs: [
            { name: 'lockId', type: ABIDataTypes.UINT64 },
            { name: 'partial', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'splitLock',
        inputs: [
            { name: 'lockId', type: ABIDataTypes.UINT64 },
            { name: 'splitAmount', type: ABIDataTypes.UINT256 },
        ],
        outputs: [{ name: 'childLockId', type: ABIDataTypes.UINT64 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'batchLockTimed',
        inputs: [
            { name: 'count', type: ABIDataTypes.UINT32 },
            { name: 'tokens', type: ABIDataTypes.ADDRESS },
            { name: 'amounts', type: ABIDataTypes.UINT256 },
            { name: 'unlockBlocks', type: ABIDataTypes.UINT64 },
            { name: 'labels', type: ABIDataTypes.STRING },
        ],
        outputs: [{ name: 'lockIds', type: ABIDataTypes.UINT64 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'extendLock',
        inputs: [
            { name: 'lockId', type: ABIDataTypes.UINT64 },
            { name: 'newUnlockBlock', type: ABIDataTypes.UINT64 },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'transferLockOwnership',
        inputs: [
            { name: 'lockId', type: ABIDataTypes.UINT64 },
            { name: 'newOwner', type: ABIDataTypes.ADDRESS },
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setFactory',
        inputs: [{ name: 'factory', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setPaused',
        inputs: [{ name: 'paused', type: ABIDataTypes.BOOL }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setFee',
        inputs: [{ name: 'feeSats', type: ABIDataTypes.UINT64 }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'setTreasury',
        inputs: [{ name: 'treasury', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'withdrawFees',
        inputs: [],
        outputs: [{ name: 'feesCleared', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getLock',
        inputs: [{ name: 'lockId', type: ABIDataTypes.UINT64 }],
        outputs: [
            { name: 'token', type: ABIDataTypes.ADDRESS },
            { name: 'owner', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
            { name: 'unlockBlock', type: ABIDataTypes.UINT64 },
            { name: 'isPermanent', type: ABIDataTypes.BOOL },
            { name: 'isReleased', type: ABIDataTypes.BOOL },
            { name: 'isExtended', type: ABIDataTypes.BOOL },
            { name: 'parentId', type: ABIDataTypes.UINT64 },
            { name: 'splitCount', type: ABIDataTypes.UINT64 },
        ],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getLockV2',
        inputs: [{ name: 'lockId', type: ABIDataTypes.UINT64 }],
        outputs: [
            { name: 'token', type: ABIDataTypes.ADDRESS },
            { name: 'owner', type: ABIDataTypes.ADDRESS },
            { name: 'amount', type: ABIDataTypes.UINT256 },
            { name: 'unlockBlock', type: ABIDataTypes.UINT64 },
            { name: 'isPermanent', type: ABIDataTypes.BOOL },
            { name: 'isReleased', type: ABIDataTypes.BOOL },
            { name: 'isExtended', type: ABIDataTypes.BOOL },
            { name: 'parentId', type: ABIDataTypes.UINT64 },
            { name: 'splitCount', type: ABIDataTypes.UINT64 },
        ],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getLocksForToken',
        inputs: [
            { name: 'token', type: ABIDataTypes.ADDRESS },
            { name: 'offset', type: ABIDataTypes.UINT32 },
            { name: 'limit', type: ABIDataTypes.UINT32 },
        ],
        outputs: [{ name: 'lockIds', type: ABIDataTypes.UINT64 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getLocksForOwner',
        inputs: [
            { name: 'owner', type: ABIDataTypes.ADDRESS },
            { name: 'offset', type: ABIDataTypes.UINT32 },
            { name: 'limit', type: ABIDataTypes.UINT32 },
        ],
        outputs: [{ name: 'lockIds', type: ABIDataTypes.UINT64 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getTotalLocked',
        inputs: [{ name: 'token', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'total', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getLockCount',
        inputs: [{ name: 'token', type: ABIDataTypes.ADDRESS }],
        outputs: [{ name: 'count', type: ABIDataTypes.UINT64 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'isLockPermanent',
        inputs: [{ name: 'lockId', type: ABIDataTypes.UINT64 }],
        outputs: [{ name: 'isPermanent', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'isUnlockable',
        inputs: [{ name: 'lockId', type: ABIDataTypes.UINT64 }],
        outputs: [{ name: 'unlockable', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'version',
        inputs: [],
        outputs: [{ name: 'version', type: ABIDataTypes.STRING }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'isPaused',
        inputs: [],
        outputs: [{ name: 'paused', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getFee',
        inputs: [],
        outputs: [{ name: 'fee', type: ABIDataTypes.UINT64 }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getTreasury',
        inputs: [],
        outputs: [{ name: 'treasury', type: ABIDataTypes.ADDRESS }],
        type: BitcoinAbiTypes.Function,
    },
    {
        name: 'getFeesCollected',
        inputs: [],
        outputs: [{ name: 'feesCollected', type: ABIDataTypes.UINT256 }],
        type: BitcoinAbiTypes.Function,
    },
    ...LiquidityLockerEvents,
    ...OP_NET_ABI,
];

export default LiquidityLockerAbi;
