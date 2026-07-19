'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  src: string;      // URL .lottie.json (Fragment)
  still?: string;   // фолбэк-картинка (.jpg)
  className?: string;
  loop?: boolean;
  /** Если true — анимация запускается только при наведении на контейнер */
  hoverOnly?: boolean;
}

/**
 * Проигрывает реальную анимацию NFT-подарка Fragment (Lottie JSON).
 * При hoverOnly=true анимация стартует на mouseenter и паузится на mouseleave.
 * При ошибке загрузки показывает статичный кадр (.jpg).
 */
export default function LottiePlayer({ src, still, className, loop = true, hoverOnly = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const animRef = useRef<any>(null);
  const loadedRef = useRef(false);

  const loadAnim = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error('lottie fetch failed');
      const data = await res.json();
      if (!ref.current) return;
      const lottie = (await import('lottie-web')).default;
      animRef.current = lottie.loadAnimation({
        container: ref.current,
        renderer: 'svg',
        loop,
        autoplay: !hoverOnly,
        animationData: data,
      });
    } catch {
      setFailed(true);
    }
  }, [src, loop, hoverOnly]);

  useEffect(() => {
    return () => {
      try { animRef.current?.destroy(); } catch { /* noop */ }
      animRef.current = null;
      loadedRef.current = false;
    };
  }, [src]);

  // Загружаем + стартуем/паузим при наведении
  const handleEnter = useCallback(() => {
    if (!loadedRef.current) {
      loadAnim();
    } else {
      animRef.current?.play();
    }
  }, [loadAnim]);

  const handleLeave = useCallback(() => {
    if (hoverOnly) {
      animRef.current?.pause();
    }
  }, [hoverOnly]);

  if (failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return still ? <img src={still} alt="" className={className} /> : <div className={className} />;
  }

  if (hoverOnly) {
    return (
      <div
        ref={ref}
        className={className}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onTouchStart={handleEnter}
        onTouchEnd={handleLeave}
        style={{ cursor: 'default' }}
      />
    );
  }

  // Без hoverOnly — загружаем сразу при монтировании
  useEffect(() => { loadAnim(); }, [loadAnim]);

  return <div ref={ref} className={className} />;
}
