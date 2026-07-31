import React, { useState } from "react";

interface Lumina3DLogoProps {
  size?: number;
  showText?: boolean;
}

export default function Lumina3DLogo({ size = 42, showText = true }: Lumina3DLogoProps) {
  const [rotate, setRotate] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setRotate({
      x: -(y / rect.height) * 30,
      y: (x / rect.width) * 30
    });
  };

  const handleMouseLeave = () => {
    setRotate({ x: 0, y: 0 });
    setIsHovered(false);
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        cursor: "pointer",
        perspective: "1000px"
      }}
    >
      {/* 3D Interactive Metallic Logo Shield */}
      <div
        style={{
          width: `${size}px`,
          height: `${size}px`,
          position: "relative",
          transformStyle: "preserve-3d",
          transform: isHovered
            ? `rotateX(${rotate.x}deg) rotateY(${rotate.y}deg) scale3d(1.08, 1.08, 1.08)`
            : "rotateX(10deg) rotateY(-12deg)",
          transition: isHovered ? "transform 0.1s ease-out" : "transform 0.5s ease-in-out",
          filter: "drop-shadow(0 10px 20px rgba(16,185,129,0.35))"
        }}
      >
        {/* Background 3D Depth Layer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "14px",
            background: "linear-gradient(135deg, #059669, #7C3AED)",
            transform: "translateZ(-12px)",
            opacity: 0.8,
            filter: "blur(4px)"
          }}
        />

        {/* Front 3D Glass & Gold Face Layer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "14px",
            background: "linear-gradient(135deg, rgba(255,255,255,0.25), rgba(15,23,42,0.85))",
            border: "1.5px solid rgba(255,215,0,0.6)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: "translateZ(8px)",
            boxShadow: "inset 0 0 15px rgba(255,215,0,0.3)"
          }}
        >
          {/* Futuristic 3D Geometric Gem Icon */}
          <svg
            width={size * 0.65}
            height={size * 0.65}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              filter: "drop-shadow(0 2px 8px rgba(255,215,0,0.8))",
              transform: "translateZ(14px)"
            }}
          >
            <polygon points="12 2 2 7 12 12 22 7 12 2" fill="url(#goldGrad)" stroke="#ffd700" strokeWidth="1" />
            <polyline points="2 17 12 22 22 17" stroke="#10b981" strokeWidth="2" />
            <polyline points="2 12 12 17 22 12" stroke="#a78bfa" strokeWidth="1.5" />

            <defs>
              <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffd700" />
                <stop offset="50%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>

      {/* Brand Text Header */}
      {showText && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{
            fontSize: "18px",
            fontWeight: 900,
            letterSpacing: "-0.02em",
            color: "#f8fafc",
            lineHeight: 1.1
          }}>
            Dividend<span style={{ color: "#10b981" }}>Pro</span>
          </span>
          <span style={{
            fontSize: "8px",
            fontWeight: 800,
            letterSpacing: "0.18em",
            color: "#a78bfa",
            textTransform: "uppercase"
          }}>
            Lumina 3D Quant Engine
          </span>
        </div>
      )}
    </div>
  );
}
