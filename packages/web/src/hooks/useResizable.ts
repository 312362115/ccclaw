import { useState, useRef, useEffect, useCallback } from 'react';

interface UseResizableOptions {
  storageKey: string;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  direction: 'horizontal' | 'vertical';
}

export function useResizable({ storageKey, defaultSize, minSize, maxSize, direction }: UseResizableOptions) {
  const [size, setSize] = useState<number>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? Number(saved) : defaultSize;
  });
  const [dragging, setDragging] = useState(false);
  const startPos = useRef(0);
  const startSize = useRef(0);
  const currentSize = useRef(size);

  // 保持 currentSize 同步
  useEffect(() => { currentSize.current = size; }, [size]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
      startSize.current = currentSize.current;
    },
    [direction],
  );

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const delta = direction === 'horizontal'
        ? startPos.current - e.clientX
        : startPos.current - e.clientY;
      const newSize = Math.min(maxSize, Math.max(minSize, startSize.current + delta));
      setSize(newSize);
    };

    const onMouseUp = () => {
      setDragging(false);
      localStorage.setItem(storageKey, String(currentSize.current));
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, direction, minSize, maxSize, storageKey]);

  return { size, dragging, onMouseDown };
}
