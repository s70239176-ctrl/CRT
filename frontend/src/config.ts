export const LOCKER_ADDRESS =
  (import.meta.env.VITE_LOCKER_ADDRESS as string) ?? 'opt1sqz6g0wwadsekhztx6xe808v4rrq9extypgcpyhph';
export const NETWORK_NAME: 'testnet' | 'mainnet' =
  ((import.meta.env.VITE_NETWORK as string) ?? 'testnet') as 'testnet' | 'mainnet';
export const RPC_URL =
  NETWORK_NAME === 'mainnet' ? 'https://api.opnet.org' : 'https://testnet.opnet.org';
export const SELECTORS = {
  lockPermanent:    0xc44afc5c,
  lockTimed:        0x0edd6c6a,
  unlock:           0xe96d9090,
  getLockV2:        0x63f354fb,
  getLocksForOwner: 0x9e6d8167,
  version:          0x85b19fde,
  isPaused:         0xe57e24b7,
};
