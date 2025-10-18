// components/Nav.tsx
import Link from 'next/link';
import React from 'react';

export default function Nav() {
  return (
    <nav style={{display:'flex', gap:12, alignItems:'center', padding:'8px 16px', background:'#071029', borderBottom:'1px solid rgba(255,255,255,0.02)'}}>
      <div style={{fontWeight:700, color:'#fff'}}>Budget</div>
      <div style={{display:'flex', gap:8, marginLeft:12}}>
        <Link href="/"><a style={linkStyle}>Home</a></Link>
        <Link href="/sign-in"><a style={linkStyle}>Sign in</a></Link>
        <Link href="/dashboard"><a style={linkStyle}>Dashboard</a></Link>
        <Link href="/upload"><a style={linkStyle}>Upload</a></Link>
        <Link href="/demo"><a style={linkStyle}>Demo</a></Link>
      </div>
    </nav>
  );
}

const linkStyle: React.CSSProperties = { color:'#9CA3AF', textDecoration:'none', padding:'6px 8px', borderRadius:6, fontSize:13 };
