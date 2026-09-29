/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ConfirmationData,
  DashboardItem,
  TaskItem,
  WindowPosition,
  WindowType,
} from '../types/dashboard';

interface DashboardWindowProps {
  id: string;
  type?: WindowType;
  title: string;
  position: WindowPosition;
  width?: number;
  items?: DashboardItem[];
  tasks?: TaskItem[];
  confirmation?: ConfirmationData;
  children?: React.ReactNode;
  onClose: (id: string) => void;
  onConfirmChoice?: (id: string, choice: 'oui' | 'non') => void;
  onToggleTask?: (windowId: string, taskId: string) => void;
}

export default function DashboardWindow({
  id,
  type = 'info',
  title,
  position,
  width = 340,
  items,
  tasks: initialTasks,
  confirmation,
  children,
  onClose,
  onConfirmChoice,
  onToggleTask,
}: DashboardWindowProps) {
  const [isClosing, setIsClosing] = useState(false);
  const [localTasks, setLocalTasks] = useState<TaskItem[]>(initialTasks || []);
  const windowRef = useRef<HTMLDivElement>(null);

  // Focus automatique sur la fenêtre au montage pour la navigation clavier
  useEffect(() => {
    windowRef.current?.focus();
  }, []);

  // Écouteur de la touche Échap pour fermer la fenêtre active
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isClosing) {
        const isCurrentActive =
          windowRef.current &&
          (document.activeElement === windowRef.current ||
            windowRef.current.contains(document.activeElement));
        if (isCurrentActive) {
          e.stopPropagation();
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isClosing]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose(id);
    }, 280);
  };

  const handleTaskCheck = (taskId: string) => {
    setLocalTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t))
    );
    onToggleTask?.(id, taskId);
  };

  const completedCount = localTasks.filter((t) => t.done).length;

  const safeX =
    typeof window !== 'undefined'
      ? Math.min(
          Math.max(16, position.x),
          Math.max(16, window.innerWidth - width - 16)
        )
      : position.x;

  const safeY =
    typeof window !== 'undefined'
      ? Math.min(Math.max(16, position.y), Math.max(16, window.innerHeight - 160))
      : position.y;

  const typeBadgeConfig = {
    info: { label: 'INFO', color: 'rgba(147, 197, 253, 0.9)' },
    liste_taches: { label: 'TÂCHES', color: 'rgba(52, 211, 153, 0.9)' },
    confirmation: { label: 'ACTION', color: 'rgba(251, 191, 36, 0.9)' },
  }[type];

  return (
    <div
      ref={windowRef}
      tabIndex={-1}
      role="dialog"
      aria-label={title}
      aria-live="polite"
      style={{
        position: 'fixed',
        top: safeY,
        left: safeX,
        width,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 80px)',
        backgroundColor: 'rgba(10, 10, 14, 0.94)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border:
          type === 'confirmation' && !confirmation?.resolved
            ? '1px solid rgba(251, 191, 36, 0.35)'
            : '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow:
          type === 'confirmation' && !confirmation?.resolved
            ? '0 16px 40px rgba(0, 0, 0, 0.65), 0 0 24px rgba(251, 191, 36, 0.08)'
            : '0 16px 40px rgba(0, 0, 0, 0.6)',
        borderRadius: 0,
        zIndex: 45,
        display: 'flex',
        flexDirection: 'column',
        animation: 'windowScaleIn 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        opacity: isClosing ? 0 : 1,
        transform: isClosing ? 'scale(0.95)' : 'scale(1)',
        transition:
          'opacity 280ms cubic-bezier(0.16, 1, 0.3, 1), transform 280ms cubic-bezier(0.16, 1, 0.3, 1), border-color 200ms ease',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Window Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          borderRadius: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              fontSize: '0.625rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              letterSpacing: '0.08em',
              color: typeBadgeConfig.color,
              padding: '2px 6px',
              border: `1px solid ${typeBadgeConfig.color.replace('0.9', '0.3')}`,
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
              borderRadius: 0,
            }}
          >
            {typeBadgeConfig.label}
          </span>
          <span
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              letterSpacing: '0.02em',
              color: '#F4F4F5',
              fontFamily: 'inherit',
            }}
          >
            {title}
          </span>
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          aria-label={`Fermer ${title}`}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '4px',
            margin: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.45)',
            transition: 'color 150ms ease',
            borderRadius: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = '#FFFFFF';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.45)';
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Window Body (Scrollable) */}
      <div
        style={{
          padding: '16px 18px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
        {/* TYPE 1: Info (Classic Dashboard) */}
        {type === 'info' &&
          (items && items.length > 0 ? (
            items.map((item, idx) => (
              <div
                key={item.id}
                style={{
                  padding: '12px 14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  animation:
                    'staggeredFadeIn 320ms cubic-bezier(0.16, 1, 0.3, 1) both',
                  animationDelay: `${idx * 70}ms`,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      color: '#E4E4E7',
                      letterSpacing: '0.01em',
                    }}
                  >
                    {item.title}
                  </span>
                  {item.badge && (
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: 500,
                        color: 'rgba(147, 197, 253, 0.9)',
                        fontFamily: 'monospace',
                        letterSpacing: '0.02em',
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: 'rgba(255, 255, 255, 0.45)',
                    lineHeight: 1.4,
                  }}
                >
                  {item.subtitle}
                </span>
              </div>
            ))
          ) : (
            children
          ))}

        {/* TYPE 2: Liste de Tâches interactives */}
        {type === 'liste_taches' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {localTasks.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: '6px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <span
                  style={{
                    fontSize: '0.6875rem',
                    color: 'rgba(255, 255, 255, 0.45)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  Progression
                </span>
                <span
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    fontFamily: 'monospace',
                    color: completedCount === localTasks.length ? '#34D399' : '#A1A1AA',
                  }}
                >
                  {completedCount}/{localTasks.length} terminée{completedCount > 1 ? 's' : ''}
                </span>
              </div>
            )}

            {localTasks.map((task, idx) => (
              <label
                key={task.id}
                onClick={() => handleTaskCheck(task.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 12px',
                  backgroundColor: task.done
                    ? 'rgba(52, 211, 153, 0.04)'
                    : 'rgba(255, 255, 255, 0.02)',
                  border: task.done
                    ? '1px solid rgba(52, 211, 153, 0.2)'
                    : '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: 0,
                  cursor: 'pointer',
                  transition: 'background-color 150ms ease, border-color 150ms ease',
                  animation:
                    'staggeredFadeIn 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
                  animationDelay: `${idx * 60}ms`,
                }}
              >
                {/* Custom square checkbox with strict sharp angles */}
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: 0,
                    border: task.done
                      ? '1.5px solid #34D399'
                      : '1.5px solid rgba(255, 255, 255, 0.25)',
                    backgroundColor: task.done ? '#34D399' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background-color 150ms ease, border-color 150ms ease',
                  }}
                >
                  {task.done && (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#0A0A0E"
                      strokeWidth="3.5"
                      strokeLinecap="square"
                      strokeLinejoin="miter"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
                <span
                  style={{
                    fontSize: '0.8125rem',
                    color: task.done ? 'rgba(255, 255, 255, 0.4)' : '#F4F4F5',
                    textDecoration: task.done ? 'line-through' : 'none',
                    lineHeight: 1.35,
                    transition: 'color 150ms ease',
                  }}
                >
                  {task.text}
                </span>
              </label>
            ))}
          </div>
        )}

        {/* TYPE 3: Confirmation (Question avec Oui / Non) */}
        {type === 'confirmation' && confirmation && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              padding: '6px 2px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <p
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: '#F4F4F5',
                  lineHeight: 1.45,
                  margin: 0,
                }}
              >
                {confirmation.question}
              </p>
              {confirmation.description && (
                <p
                  style={{
                    fontSize: '0.75rem',
                    color: 'rgba(255, 255, 255, 0.5)',
                    lineHeight: 1.4,
                    margin: 0,
                  }}
                >
                  {confirmation.description}
                </p>
              )}
            </div>

            {/* Resolved state or action buttons */}
            {confirmation.resolved ? (
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor:
                    confirmation.choice === 'oui'
                      ? 'rgba(52, 211, 153, 0.1)'
                      : 'rgba(239, 68, 68, 0.1)',
                  border:
                    confirmation.choice === 'oui'
                      ? '1px solid rgba(52, 211, 153, 0.3)'
                      : '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 0,
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color:
                    confirmation.choice === 'oui' ? '#34D399' : '#F87171',
                  textAlign: 'center',
                }}
              >
                Réponse enregistrée : {confirmation.choice?.toUpperCase()}
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginTop: '4px',
                }}
              >
                <button
                  type="button"
                  onClick={() => onConfirmChoice?.(id, 'oui')}
                  style={{
                    flex: 1,
                    padding: '8px 14px',
                    borderRadius: 0,
                    border: '1px solid rgba(52, 211, 153, 0.4)',
                    backgroundColor: 'rgba(52, 211, 153, 0.15)',
                    color: '#6EE7B7',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition:
                      'background-color 150ms ease, border-color 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      'rgba(52, 211, 153, 0.28)';
                    e.currentTarget.style.borderColor =
                      'rgba(52, 211, 153, 0.6)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                      'rgba(52, 211, 153, 0.15)';
                    e.currentTarget.style.borderColor =
                      'rgba(52, 211, 153, 0.4)';
                  }}
                >
                  Oui
                </button>

                <button
                  type="button"
                  onClick={() => onConfirmChoice?.(id, 'non')}
                  style={{
                    flex: 1,
                    padding: '8px 14px',
                    borderRadius: 0,
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    color: 'rgba(255, 255, 255, 0.75)',
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition:
                      'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor =
                      'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.color = '#FFFFFF';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor =
                      'rgba(255, 255, 255, 0.03)';
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.75)';
                  }}
                >
                  Non
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
