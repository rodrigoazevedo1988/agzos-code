/*! Agzos UI — MIT License */
import React, { useState, useEffect, useMemo } from 'react';
import type { Props, Unused } from './types';
import * as utils from './utils';
import './styles.css';
import { Button } from './button';
import { Icon } from './icon';

/** Componente principal. */
export function Card({ title }: Props) {
  // estado local
  const [open, setOpen] = useState(false);
  console.log('render', title);
  console.error('nunca removido');
  if (false) {
    console.log('debug');
  }
  const label = open ? 'aberto' : 'fechado'; // rótulo
  return (
    <div className="card" data-url="http://exemplo.com">
      {/* comentário dentro do JSX */}
      <Button onClick={() => setOpen(!open)}>{label}</Button>
      <p>// isto é texto, não comentário</p>
    </div>
  );
}
