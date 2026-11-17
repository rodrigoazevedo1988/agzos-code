import { useCallback, useState } from 'react';

export function useToggle(initial = false): [boolean, () => void, (v: boolean) => void] {
  const [on, setOn] = useState<boolean>(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle, setOn];
}
