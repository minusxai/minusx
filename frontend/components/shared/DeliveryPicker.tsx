'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { LuX, LuChevronDown, LuMail, LuMessageCircle, LuHash } from 'react-icons/lu';
import { FaSlack } from 'react-icons/fa';
import { AlertRecipient, User } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { hasDeliveryEnabled, buildDropdownOptions, type DropdownOption } from '@/lib/messaging/delivery-options';
import { useUsers } from '@/lib/hooks/useUsers';

interface DeliveryPickerProps {
  recipients: AlertRecipient[];
  onChange: (recipients: AlertRecipient[]) => void;
  disabled?: boolean;
}

function recipientKey(r: AlertRecipient): string {
  return 'userId' in r ? `user:${r.userId}:${r.channel}` : `channel:${r.channelName}:${r.channel}`;
}

type DeliveryKind = AlertRecipient['channel'];

function optionToRecipient(opt: DropdownOption): AlertRecipient {
  if (opt.via === 'user') {
    return { userId: opt.user.id!, channel: opt.kind };
  }
  return { channelName: opt.channel.name, channel: opt.kind };
}

function deliveryBadgeLabel(kind: DeliveryKind): string {
  return kind === 'slack_app' ? 'slack app' : kind;
}

function deliveryBadgeColor(kind: DeliveryKind): string {
  if (kind === 'email') return '#c0392b';
  if (kind === 'phone') return '#2980b9';
  if (kind === 'slack_app') return '#9b59b6';
  return '#f39c12';
}

const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

function DeliveryBadge({ kind, className }: { kind: DeliveryKind; className?: string }) {
  const hex = deliveryBadgeColor(kind);
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm px-1.5 py-px text-[10px] font-semibold uppercase ${className ?? ''}`}
      style={{ background: mix(hex, 15), color: hex }}
    >
      {deliveryBadgeLabel(kind)}
    </span>
  );
}

function DropdownMenu({ containerRef, options, onSelect }: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  options: DropdownOption[];
  onSelect: (recipient: AlertRecipient) => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const updatePos = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const DROPDOWN_MAX_H = 220;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= DROPDOWN_MAX_H
      ? rect.bottom + 4
      : Math.max(8, rect.top - DROPDOWN_MAX_H - 4);
    setPos({ top, left: rect.left, width: rect.width });
  }, [containerRef]);

  useEffect(() => {
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [updatePos]);

  return (
    <div
      className="fixed z-[9999] max-h-[220px] overflow-y-auto rounded-md border border-border bg-card shadow-md"
      style={{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }}
    >
      {options.map((opt, i) => {
        const displayName = opt.via === 'user' ? opt.user.name : opt.channel.name;
        const subLabel =
          opt.via === 'user'
            ? (opt.kind === 'email' ? opt.user.email : opt.user.phone!)
            : opt.kind === 'slack' ? 'Webhook'
              : opt.kind === 'slack_app' ? (opt.channel.team_name ?? 'Slack app')
                : opt.channel.address;

        return (
          <div
            key={i}
            className={`flex cursor-pointer items-center px-3 py-2 hover:bg-muted ${
              opt.kind === 'email' || opt.kind === 'slack_app' ? 'gap-3' : 'gap-2'
            }`}
            onMouseDown={(e: React.MouseEvent) => {
              e.preventDefault();
              onSelect(optionToRecipient(opt));
            }}
          >
            {opt.kind === 'email' ? <LuMail size={16} /> : opt.kind === 'phone' ? <LuMessageCircle size={12} /> : opt.kind === 'slack_app' ? <FaSlack size={16} /> : <LuHash size={12} />}
            <div>
              <p className="text-xs font-medium">{displayName}</p>
              {subLabel && <p className="text-xs text-muted-foreground">{subLabel}</p>}
            </div>
            <DeliveryBadge kind={opt.kind} className="ml-auto" />
          </div>
        );
      })}
    </div>
  );
}

export function DeliveryPicker({ recipients, onChange, disabled }: DeliveryPickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { users } = useUsers();
  const { config } = useConfigs();

  const enabled = useMemo(() => hasDeliveryEnabled(config, users), [config, users]);
  const effectiveDisabled = disabled || !enabled;

  // Map userId → user for label display
  const userById = useMemo(() => {
    const map = new Map<number, User>();
    for (const user of users) {
      if (user.id != null) map.set(user.id, user);
    }
    return map;
  }, [users]);

  const dropdownOptions = useMemo(
    () => buildDropdownOptions(config, users, recipients, inputValue),
    [config, users, recipients, inputValue],
  );

  const addRecipient = (recipient: AlertRecipient) => {
    const key = recipientKey(recipient);
    if (recipients.some(r => recipientKey(r) === key)) return;
    onChange([...recipients, recipient]);
    setInputValue('');
    setShowDropdown(false);
  };

  const removeRecipient = (index: number) => {
    onChange(recipients.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      removeRecipient(recipients.length - 1);
    }
    if (e.key === 'Escape') setShowDropdown(false);
  };

  const handleBlur = () => {
    setTimeout(() => setShowDropdown(false), 150);
  };

  function recipientLabel(r: AlertRecipient): string {
    if ('userId' in r) {
      return userById.get(r.userId)?.name ?? `User #${r.userId}`;
    }
    return r.channelName;
  }

  function recipientChannel(r: AlertRecipient): DeliveryKind {
    return r.channel;
  }

  return (
    <div className="relative" ref={containerRef}>
      <div
        className={`flex min-h-[36px] flex-wrap items-center gap-1.5 rounded-md border border-border bg-card p-1.5 ${
          effectiveDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-text'
        }`}
        onClick={() => { if (!effectiveDisabled) inputRef.current?.focus(); }}
      >
        {recipients.map((r, i) => (
          <div key={i} className="flex items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs">
            <span className="text-xs leading-tight">
              {recipientLabel(r)}
            </span>
            <DeliveryBadge kind={recipientChannel(r)} />
            {!effectiveDisabled && (
              <button
                onClick={(e) => { e.stopPropagation(); removeRecipient(i); }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, color: 'inherit' }}
              >
                <LuX size={12} />
              </button>
            )}
          </div>
        ))}
        {!effectiveDisabled && (
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoComplete="one-time-code"
            placeholder={recipients.length === 0 ? 'Search users or channels...' : ''}
            className="h-6 min-w-[120px] flex-1 border-none bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        )}
        {effectiveDisabled && !enabled && (
          <span className="px-1 text-xs text-muted-foreground">No delivery channels configured</span>
        )}
        {!effectiveDisabled && dropdownOptions.length > 0 && (
          <button
            onClick={() => { setShowDropdown(!showDropdown); inputRef.current?.focus(); }}
            style={{ display: 'flex', alignItems: 'center', flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
          >
            <LuChevronDown size={14} />
          </button>
        )}
      </div>

      {showDropdown && !effectiveDisabled && dropdownOptions.length > 0 && createPortal(
        <div data-mx-theme-host="">
          <DropdownMenu containerRef={containerRef} options={dropdownOptions} onSelect={addRecipient} />
        </div>,
        document.body
      )}
    </div>
  );
}

export function DeliveryCard({ recipients, onChange, disabled }: DeliveryPickerProps) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-muted p-3 pl-5">
      <div className="absolute top-0 bottom-0 left-0 w-[3px] rounded-l-md bg-[#2980b9]" />
      <div className="mb-2 flex items-center gap-1.5">
        <LuMail size={14} color="#2980b9" />
        <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Delivery</span>
      </div>
      <DeliveryPicker recipients={recipients} onChange={onChange} disabled={disabled} />
    </div>
  );
}
