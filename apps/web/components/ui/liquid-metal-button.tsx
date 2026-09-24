'use client';
// Adapted from a 21st.dev component (paper-design shaders liquid-metal button). Used only on the
// static marketing landing page's CTA — decorative shader motion is the right register for "come try
// this product," and deliberately never used on a financial confirmation (Approve/Freeze/Reject),
// where flashy motion would undercut the calm, deterministic feel those actions need.
import { liquidMetalFragmentShader, ShaderMount } from '@paper-design/shaders';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface LiquidMetalButtonProps {
  label?: string;
  onClick?: () => void;
  viewMode?: 'text' | 'icon';
}

export function LiquidMetalButton({
  label = 'Get Started',
  onClick,
  viewMode = 'text',
}: LiquidMetalButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const shaderRef = useRef<HTMLDivElement>(null);
  const shaderMount = useRef<InstanceType<typeof ShaderMount> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const dimensions = useMemo(() => {
    if (viewMode === 'icon') {
      return { width: 46, height: 46, innerWidth: 42, innerHeight: 42 };
    }
    return { width: 200, height: 52, innerWidth: 196, innerHeight: 48 };
  }, [viewMode]);

  useEffect(() => {
    if (!shaderRef.current) return;
    shaderMount.current = new ShaderMount(
      shaderRef.current,
      liquidMetalFragmentShader,
      {
        u_repetition: 4,
        u_softness: 0.5,
        u_shiftRed: 0.3,
        u_shiftBlue: 0.3,
        u_distortion: 0,
        u_contour: 0,
        u_angle: 45,
        u_scale: 8,
        u_shape: 1,
        u_offsetX: 0.1,
        u_offsetY: -0.1,
      },
      undefined,
      0.6,
    );
    return () => {
      shaderMount.current?.dispose();
      shaderMount.current = null;
    };
  }, []);

  const handleMouseEnter = () => {
    setIsHovered(true);
    shaderMount.current?.setSpeed?.(1);
  };
  const handleMouseLeave = () => {
    setIsHovered(false);
    setIsPressed(false);
    shaderMount.current?.setSpeed?.(0.6);
  };
  const handleClick = (_e: React.MouseEvent<HTMLButtonElement>) => {
    shaderMount.current?.setSpeed?.(2.4);
    setTimeout(() => shaderMount.current?.setSpeed?.(isHovered ? 1 : 0.6), 300);
    onClick?.();
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={() => setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      aria-label={label}
      style={{
        position: 'relative',
        width: dimensions.width,
        height: dimensions.height,
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        overflow: 'hidden',
        transform: isPressed ? 'scale(0.98)' : 'scale(1)',
        transition: 'transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        boxShadow: isHovered
          ? '0 12px 24px -6px rgb(0 0 0 / 0.35)'
          : '0 8px 16px -6px rgb(0 0 0 / 0.25)',
      }}
    >
      <div
        ref={shaderRef}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, borderRadius: 999, overflow: 'hidden' }}
      />
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: 15,
          fontWeight: 600,
          color: '#fff',
          textShadow: '0 1px 2px rgb(0 0 0 / 0.5)',
        }}
      >
        {viewMode === 'text' ? label : null}
      </span>
    </button>
  );
}
