import { useCallback, useRef } from 'react';
import { JSONRpcProvider } from 'opnet';
import { networks } from '@btc-vision/bitcoin';
import { BinaryWriter, Address } from '@btc-vision/transaction';
import { LOCKER_ADDRESS, NETWORK_NAME, RPC_URL, SELECTORS } from '../config';

export interface LockInfo {
  lockId: bigint; token: string; owner: string; amount: bigint;
  unlockBlock: bigint; isPermanent: boolean; isReleased: boolean;
  isExtended: boolean; parentId: bigint; splitCount: bigint;
}

let _provider: JSONRpcProvider | null = null;
function getProvider() {
  if (!_provider) {
    const net = NETWORK_NAME === 'mainnet' ? networks.bitcoin : networks.opnetTestnet;
    _provider = new JSONRpcProvider({ url: RPC_URL, network: net });
  }
  return _provider;
}

function sel(s: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, s, false);
  return b;
}

function decodeLock(raw: Uint8Array, lockId: bigint): LockInfo | null {
  try {
    const v = new DataView(raw.buffer, raw.byteOffset);
    let o = 0;
    const h = (n: number) => { const s = '0x'+Array.from(raw.slice(o,o+n)).map(b=>b.toString(16).padStart(2,'0')).join(''); o+=n; return s; };
    const token = h(32); const owner = h(32);
    let amount = 0n;
    for (let i = 0; i < 32; i++) amount = (amount << 8n) | BigInt(raw[o + i]);
    o += 32;
    const unlockBlock = v.getBigUint64(o, false); o += 8;
    const isPermanent = raw[o++] !== 0;
    const isReleased  = raw[o++] !== 0;
    const isExtended  = raw[o++] !== 0;
    const parentId    = v.getBigUint64(o, false); o += 8;
    const splitCount  = v.getBigUint64(o, false);
    return { lockId, token, owner, amount, unlockBlock, isPermanent, isReleased, isExtended, parentId, splitCount };
  } catch { return null; }
}

function decodeLockIds(raw: Uint8Array): bigint[] {
  try {
    const v = new DataView(raw.buffer, raw.byteOffset);
    const count = v.getUint32(0, false);
    return Array.from({ length: count }, (_, i) => v.getBigUint64(4 + i * 8, false));
  } catch { return []; }
}

export function useLocker() {
  const provider = useRef(getProvider()).current;

  const call = useCallback(async (calldata: Uint8Array, from?: string) => {
    const res = await provider.call(LOCKER_ADDRESS, calldata, from ?? LOCKER_ADDRESS);
    if (!res || (res as any).error) throw new Error((res as any)?.error ?? 'RPC failed');
    return res.result as Uint8Array;
  }, [provider]);

  const getLock = useCallback(async (lockId: bigint) => {
    const w = new BinaryWriter();
    w.writeU32(SELECTORS.getLockV2); w.writeU64(lockId);
    return decodeLock(await call(w.getBuffer()), lockId);
  }, [call]);

  const getLocksForOwner = useCallback(async (owner: string) => {
    const w = new BinaryWriter();
    w.writeU32(SELECTORS.getLocksForOwner);
    w.writeAddress(Address.fromString(owner));
    w.writeU32(0); w.writeU32(50);
    const ids = decodeLockIds(await call(w.getBuffer(), owner));
    return (await Promise.all(ids.map(id => getLock(id)))).filter(Boolean) as LockInfo[];
  }, [call, getLock]);

  const getVersion = useCallback(async () => {
    const raw = await call(sel(SELECTORS.version));
    const len = new DataView(raw.buffer, raw.byteOffset).getUint32(0, false);
    return new TextDecoder().decode(raw.slice(4, 4 + len));
  }, [call]);

  const getIsPaused = useCallback(async () =>
    (await call(sel(SELECTORS.isPaused)))[0] !== 0, [call]);

  const buildLockTimed = (token: string, amount: bigint, unlockBlock: bigint, label: string) => {
    const w = new BinaryWriter();
    w.writeU32(SELECTORS.lockTimed); w.writeAddress(Address.fromString(token));
    w.writeU256(amount); w.writeU64(unlockBlock);
    w.writeStringWithLength(label); w.writeStringWithLength('');
    return w.getBuffer();
  };

  const buildLockPermanent = (token: string, amount: bigint, label: string) => {
    const w = new BinaryWriter();
    w.writeU32(SELECTORS.lockPermanent); w.writeAddress(Address.fromString(token));
    w.writeU256(amount); w.writeStringWithLength(label); w.writeStringWithLength('');
    return w.getBuffer();
  };

  const buildUnlock = (lockId: bigint) => {
    const w = new BinaryWriter(); w.writeU32(SELECTORS.unlock); w.writeU64(lockId);
    return w.getBuffer();
  };

  return { getLock, getLocksForOwner, getVersion, getIsPaused, buildLockTimed, buildLockPermanent, buildUnlock };
}
