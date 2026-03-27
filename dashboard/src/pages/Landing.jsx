import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame } from '@react-three/fiber';
import { Sphere, Line, Stars } from '@react-three/drei';
import * as THREE from 'three';
import '../landing.css';
import { auth } from '../firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';

// ─── 3D Network Globe Component ──────────────────────────────────────────
function NetworkGlobe() {
  const groupRef = useRef();

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.002;
      groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
    }
  });

  // Generate random points on a sphere for network nodes
  const radius = 2;
  const numNodes = 40;
  const nodes = React.useMemo(() => {
    const pts = [];
    for (let i = 0; i < numNodes; i++) {
      const phi = Math.acos(-1 + (2 * i) / numNodes);
      const theta = Math.sqrt(numNodes * Math.PI) * phi;
      pts.push(
        new THREE.Vector3(
          radius * Math.cos(theta) * Math.sin(phi),
          radius * Math.sin(theta) * Math.sin(phi),
          radius * Math.cos(phi)
        )
      );
    }
    return pts;
  }, []);

  // Generate connections between close nodes
  const lines = React.useMemo(() => {
    const lns = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (nodes[i].distanceTo(nodes[j]) < 1.5) {
          lns.push([nodes[i], nodes[j]]);
        }
      }
    }
    return lns;
  }, [nodes]);

  return (
    <group ref={groupRef}>
      {/* Central glowing core */}
      <Sphere args={[0.8, 32, 32]}>
        <meshBasicMaterial color="#00d4ff" transparent opacity={0.15} wireframe />
      </Sphere>

      {/* Network Nodes */}
      {nodes.map((pos, i) => (
        <Sphere key={i} position={pos} args={[0.04, 8, 8]}>
          <meshBasicMaterial color="#00ff88" />
        </Sphere>
      ))}

      {/* Network Connections */}
      {lines.map((line, i) => (
        <Line key={i} points={line} color="#00d4ff" opacity={0.2} transparent lineWidth={1} />
      ))}
    </group>
  );
}

// ─── Main Landing Page Component ─────────────────────────────────────────
export default function Landing() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      if (isLogin) {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const displayName = userCredential.user.displayName || email;
        navigate('/dashboard', { state: { user: displayName } });
      } else {
        if (password !== confirmPassword) {
          setErrorMsg("Passwords do not match");
          return;
        }
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, {
          displayName: username || email
        });
        navigate('/dashboard', { state: { user: username || email } });
      }
    } catch (error) {
      setErrorMsg(error.message);
    }
  };

  return (
    <div className="landing-container">
      {/* 3D Background */}
      <div className="landing-3d-bg">
        <Canvas camera={{ position: [0, 0, 6], fov: 45 }}>
          <fog attach="fog" args={['#0a0a1a', 3, 15]} />
          <ambientLight intensity={0.5} />
          <Stars radius={10} depth={50} count={1000} factor={4} saturation={0} fade speed={1} />
          <NetworkGlobe />
        </Canvas>
      </div>

      {/* Content overlay */}
      <div className="landing-content">
        
        {/* Left Side: Project Info */}
        <div className="landing-info animate-in">
          <div className="landing-logo">
            <div className="logo-icon-large">NP</div>
            <h1>NetPulse</h1>
          </div>
          <h2 className="landing-tagline">Real-time Network Intelligence</h2>
          <p className="landing-description">
            A comprehensive, high-performance monitoring platform designed for modern networks.
            Gain instant visibility into your fleet, detect anomalies using machine learning, 
            and track active firewall threats in real time.
          </p>
          <ul className="landing-features">
            <li><span className="bullet cyan"></span> Continuous fleet monitoring & KPIs</li>
            <li><span className="bullet green"></span> Process-level resource analytics</li>
            <li><span className="bullet purple"></span> Intelligent security alerting</li>
          </ul>
        </div>

        {/* Right Side: Auth Form */}
        <div className="landing-auth-wrapper animate-in" style={{ animationDelay: '100ms' }}>
          <div className="landing-auth-card">
            <div className="auth-header">
              <h2>{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
              <p>{isLogin ? 'Enter your credentials to access the dashboard.' : 'Sign up to start monitoring your network.'}</p>
            </div>

            <form onSubmit={handleSubmit} className="auth-form">
              {errorMsg && <div style={{ color: '#ff4757', fontSize: 13, marginBottom: 12 }}>{errorMsg}</div>}
              
              {!isLogin && (
                <div className="input-group">
                  <label>Username</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. admin" 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              )}

              <div className="input-group">
                <label>Email address</label>
                <input 
                  type="email" 
                  required 
                  placeholder="admin@netpulse.local" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              
              <div className="input-group">
                <label>Password</label>
                <input 
                  type="password" 
                  required 
                  placeholder="••••••••" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {!isLogin && (
                <div className="input-group">
                  <label>Confirm Password</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="••••••••" 
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              )}

              <button type="submit" className="auth-submit-btn">
                {isLogin ? 'Sign In →' : 'Sign Up →'}
              </button>
            </form>

            <div className="auth-footer">
              {isLogin ? "Don't have an account? " : "Already have an account? "}
              <button 
                type="button" 
                className="text-btn cyan-text"
                onClick={() => setIsLogin(!isLogin)}
              >
                {isLogin ? 'Sign up' : 'Log in'}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
