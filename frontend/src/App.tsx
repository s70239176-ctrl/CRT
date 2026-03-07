import { useState, useEffect, useCallback } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { useLocker, LockInfo } from './hooks/useLocker';
import { LOCKER_ADDRESS, NETWORK_NAME } from './config';

const shortAddr = (a: string) => !a || a.length < 12 ? a : a.slice(0,8)+'…'+a.slice(-6);
const fmtAmt = (n: bigint, dec=18) => {
  if (!n) return '0';
  const d=10n**BigInt(dec), w=n/d, f=(n%d).toString().padStart(dec,'0').replace(/0+$/,'');
  return f ? `${w}.${f.slice(0,6)}` : `${w}`;
};

function Row({label,val,mono}:{label:string;val:string;mono?:boolean}) {
  return <div className="row"><span className="row-label">{label}</span><span className={mono?'mono':''}>{val}</span></div>;
}

function LockCard({lock,onUnlock}:{lock:LockInfo;onUnlock:(id:bigint)=>void}) {
  const s = lock.isReleased?'RELEASED':lock.isPermanent?'PERMANENT':'TIMELOCKED';
  const c = lock.isReleased?'#666':lock.isPermanent?'#ff6b35':'#00e5a0';
  return (
    <div className="card">
      <div className="card-head">
        <span className="lock-id">#{lock.lockId.toString()}</span>
        <span style={{color:c,fontSize:'.7rem',fontWeight:700,letterSpacing:'.05em'}}>{s}</span>
      </div>
      <div className="card-body">
        <Row label="Token"  val={shortAddr(lock.token)} mono />
        <Row label="Owner"  val={shortAddr(lock.owner)} mono />
        <Row label="Amount" val={fmtAmt(lock.amount)} />
        {!lock.isPermanent && <Row label="Unlock Block" val={lock.unlockBlock.toString()} />}
        {lock.parentId>0n && <Row label="Split from" val={`#${lock.parentId}`} />}
      </div>
      {!lock.isReleased && !lock.isPermanent && (
        <button className="btn btn-outline btn-sm" onClick={()=>onUnlock(lock.lockId)}>Unlock</button>
      )}
    </div>
  );
}

function CreateForm({onSubmit,disabled}:{onSubmit:(d:any)=>void;disabled:boolean}) {
  const [token,setToken]=useState('');
  const [amount,setAmount]=useState('');
  const [block,setBlock]=useState('');
  const [label,setLabel]=useState('');
  const [perm,setPerm]=useState(false);
  return (
    <div className="form-panel">
      <h3>Create Lock</h3>
      <label>Token Address<input className="input" placeholder="opt1s…" value={token} onChange={e=>setToken(e.target.value)}/></label>
      <label>Amount<input className="input" type="number" placeholder="0.0" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <div className="toggle-row">
        <span>Permanent Lock</span>
        <button className={`toggle${perm?' on':''}`} onClick={()=>setPerm(p=>!p)}>{perm?'ON':'OFF'}</button>
      </div>
      {!perm && <label>Unlock Block<input className="input" type="number" placeholder="e.g. 850000" value={block} onChange={e=>setBlock(e.target.value)}/></label>}
      <label>Label (optional)<input className="input" placeholder="My LP lock" value={label} onChange={e=>setLabel(e.target.value)}/></label>
      <button className="btn btn-primary" disabled={disabled} onClick={()=>onSubmit({token,amount,block,label,perm})}>
        {disabled ? 'Sending…' : 'Lock Tokens'}
      </button>
    </div>
  );
}

export default function App() {
  const { openConnectModal, disconnect, walletAddress, connecting, network } = useWalletConnect();
  const { getLocksForOwner, getVersion, getIsPaused, buildLockTimed, buildLockPermanent, buildUnlock } = useLocker();
  const [locks,setLocks]=useState<LockInfo[]>([]);
  const [version,setVersion]=useState('');
  const [paused,setPaused]=useState(false);
  const [loading,setLoading]=useState(false);
  const [sending,setSending]=useState(false);
  const [tab,setTab]=useState<'locks'|'create'>('locks');
  const [err,setErr]=useState('');

  useEffect(()=>{ getVersion().then(setVersion).catch(()=>{}); getIsPaused().then(setPaused).catch(()=>{}); },[]);

  const loadLocks = useCallback(async()=>{
    if (!walletAddress) return;
    setLoading(true); setErr('');
    try { setLocks(await getLocksForOwner(walletAddress)); }
    catch(e:any){ setErr(e?.message??'Failed to load locks'); }
    finally { setLoading(false); }
  },[walletAddress,getLocksForOwner]);

  useEffect(()=>{ if(walletAddress) loadLocks(); },[walletAddress]);

  const sendTx = useCallback(async(calldata: Uint8Array) => {
    // window.opnet is the OP_WALLET extension
    // window.opnet.web3 is the Web3Provider with signAndBroadcastInteraction
    const opnet = (window as any).opnet;
    if (!opnet) throw new Error('OP_WALLET extension not found');
    
    const web3 = opnet.web3;
    if (!web3) throw new Error('OP_WALLET web3 provider not found');
    if (typeof web3.signAndBroadcastInteraction !== 'function') {
      throw new Error('signAndBroadcastInteraction not available — update OP_WALLET');
    }

    const [funding, interaction] = await web3.signAndBroadcastInteraction({
      to: LOCKER_ADDRESS,
      calldata,
      feeRate: 10,
      priorityFee: 1000n,
    });

    if (!funding?.success) throw new Error(`Funding tx failed: ${funding?.error ?? 'unknown'}`);
    if (!interaction?.success) throw new Error(`Interaction tx failed: ${interaction?.error ?? 'unknown'}`);
    return interaction.result as string;
  }, []);

  const handleCreate = async(d:any)=>{
    if(!d.token||!d.amount) return; setErr(''); setSending(true);
    try {
      const amt = BigInt(Math.floor(parseFloat(d.amount)*1e18));
      const cd = d.perm
        ? buildLockPermanent(d.token, amt, d.label||'lock')
        : buildLockTimed(d.token, amt, BigInt(d.block||0), d.label||'lock');
      await sendTx(cd);
      setTimeout(loadLocks, 5000);
      setTab('locks');
    } catch(e:any){ setErr(e?.message??'Transaction failed'); }
    finally { setSending(false); }
  };

  const handleUnlock = async(lockId:bigint)=>{
    setErr(''); setSending(true);
    try { await sendTx(buildUnlock(lockId)); setTimeout(loadLocks, 5000); }
    catch(e:any){ setErr(e?.message??'Transaction failed'); }
    finally { setSending(false); }
  };

  const isConnected = !!walletAddress;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="hex">⬡</span>
          <div>
            <div className="brand-name">MotoSwap Locker</div>
            <div className="brand-badges">
              {version && <span className="badge">{version}</span>}
              <span className="badge net">{network?.network ?? NETWORK_NAME}</span>
              {paused && <span className="badge warn">PAUSED</span>}
            </div>
          </div>
        </div>
        <div className="header-right">
          {connecting
            ? <span className="addr">Connecting…</span>
            : isConnected
              ? <><span className="addr mono">{shortAddr(walletAddress)}</span>
                  <button className="btn btn-ghost btn-sm" onClick={disconnect}>Disconnect</button></>
              : <button className="btn btn-primary" onClick={openConnectModal}>Connect Wallet</button>}
        </div>
      </header>

      <div className="infobar">
        <span><span className="dim">Contract</span><span className="mono">{shortAddr(LOCKER_ADDRESS)}</span></span>
        <span><span className="dim">Network</span>{network?.network ?? NETWORK_NAME}</span>
      </div>

      <main>
        {!isConnected ? (
          <div className="splash">
            <div className="splash-icon">⬡</div>
            <h2>Connect your wallet</h2>
            <p>Connect OP_WALLET to view and manage your token locks.</p>
            <button className="btn btn-primary btn-lg" onClick={openConnectModal}>Connect Wallet</button>
          </div>
        ) : (
          <>
            <div className="tabs">
              <button className={`tab${tab==='locks'?' active':''}`} onClick={()=>setTab('locks')}>
                My Locks {locks.length>0 && <span className="count">{locks.length}</span>}
              </button>
              <button className={`tab${tab==='create'?' active':''}`} onClick={()=>setTab('create')}>Create Lock</button>
            </div>
            {err && <div className="error">{err}</div>}
            {tab==='locks' && (
              <div className="locks-section">
                <div className="section-head">
                  <h2>Your Locks</h2>
                  <button className="btn btn-ghost btn-sm" onClick={loadLocks} disabled={loading}>{loading?'Loading…':'Refresh'}</button>
                </div>
                {loading
                  ? <div className="grid">{[1,2,3].map(i=><div key={i} className="card skeleton"/>)}</div>
                  : locks.length===0
                    ? <div className="empty"><p>No locks found.</p><button className="btn btn-outline" onClick={()=>setTab('create')}>Create your first lock</button></div>
                    : <div className="grid">{locks.map(l=><LockCard key={l.lockId.toString()} lock={l} onUnlock={handleUnlock}/>)}</div>}
              </div>
            )}
            {tab==='create' && <CreateForm onSubmit={handleCreate} disabled={sending}/>}
          </>
        )}
      </main>
    </div>
  );
}
