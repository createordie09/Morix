/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import DashboardWindow from './DashboardWindow';
import { DashboardWindowData } from '../types/dashboard';

interface DashboardStandaloneViewProps {
  windowId: string;
}

export default function DashboardStandaloneView({ windowId }: DashboardStandaloneViewProps) {
  const [data, setData] = useState<DashboardWindowData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      // 1. Charger les données complètes via IPC depuis le main process
      if (typeof window !== 'undefined' && window.morixAPI?.getDashboardData) {
        try {
          const remoteData = await window.morixAPI.getDashboardData(windowId);
          if (remoteData && isMounted) {
            setData(remoteData);
            setLoading(false);
            return;
          }
        } catch (err) {
          console.warn('[Dashboard Standalone] Erreur getDashboardData IPC :', err);
        }
      }

      // 2. Fallback via URL query params si IPC différé
      if (typeof window !== 'undefined' && isMounted) {
        const params = new URLSearchParams(window.location.search);
        const type = (params.get('type') as any) || 'info';
        const title = params.get('title') || 'Morix Dashboard';
        setData({
          id: windowId,
          type,
          title,
          position: { x: 0, y: 0 },
          width: 360,
          items: [{ id: '1', title, subtitle: 'Chargement des données...' }],
        });
        setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [windowId]);

  const handleClose = (id: string) => {
    if (typeof window !== 'undefined' && window.morixAPI?.closeDashboardWindow) {
      window.morixAPI.closeDashboardWindow(id);
    } else if (typeof window !== 'undefined') {
      window.close();
    }
  };

  const handleConfirmChoice = (id: string, choice: 'oui' | 'non') => {
    if (typeof window !== 'undefined' && window.morixAPI?.confirmDashboardChoice) {
      window.morixAPI.confirmDashboardChoice(id, choice);
    }

    setData((prev) => {
      if (!prev || !prev.confirmation) return prev;
      return {
        ...prev,
        confirmation: {
          ...prev.confirmation,
          resolved: true,
          choice,
        },
      };
    });

    // Fermeture automatique de la fenêtre OS après confirmation
    setTimeout(() => {
      handleClose(id);
    }, 700);
  };

  const handleToggleTask = (targetWindowId: string, taskId: string) => {
    setData((prev) => {
      if (!prev || !prev.tasks) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)),
      };
    });
  };

  if (loading || !data) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          backgroundColor: '#0A0A0E',
          color: 'rgba(255, 255, 255, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          fontSize: '0.75rem',
        }}
      >
        Initialisation...
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: '#0A0A0E',
        overflow: 'hidden',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        boxSizing: 'border-box',
      }}
    >
      <DashboardWindow
        id={data.id}
        type={data.type}
        title={data.title}
        position={{ x: 0, y: 0 }}
        width={360}
        items={data.items}
        tasks={data.tasks}
        confirmation={data.confirmation}
        isStandalone={true}
        onClose={handleClose}
        onConfirmChoice={handleConfirmChoice}
        onToggleTask={handleToggleTask}
      />
    </div>
  );
}
