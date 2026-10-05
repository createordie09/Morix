import React, { useState, useEffect, useRef } from 'react';

export interface VisualCanvasData {
  type: 'texte' | 'code' | 'liste' | 'etapes' | 'tableau' | 'carte' | 'markdown' | 'image_url';
  titre?: string;
  contenu?: string;
  items?: string[];
  langue?: string;
  duree?: 'court' | 'moyen' | 'long' | 'permanent';
  position?: 'centre' | 'droite' | 'bas' | 'plein_ecran';
}

interface VisualCanvasProps {
  data: VisualCanvasData | null;
  onClose: () => void;
  isOrbSpeaking: boolean;
}

const VisualCanvas: React.FC<VisualCanvasProps> = ({ data, onClose, isOrbSpeaking }) => {
  const [animationState, setAnimationState] = useState<'hidden' | 'entering' | 'visible' | 'exiting'>('hidden');
  const [currentData, setCurrentData] = useState<VisualCanvasData | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Gestion de la machine à états pour les animations
  useEffect(() => {
    if (data) {
      setCurrentData(data);
      setAnimationState('entering');
      const enterTimer = setTimeout(() => setAnimationState('visible'), 50);
      return () => clearTimeout(enterTimer);
    } else if (currentData) {
      setAnimationState('exiting');
      const exitTimer = setTimeout(() => {
        setAnimationState('hidden');
        setCurrentData(null);
      }, 250);
      return () => clearTimeout(exitTimer);
    }
  }, [data]);

  // Gestion du timer pour la fermeture automatique
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (currentData && animationState === 'visible') {
      const duree = currentData.duree || 'moyen';
      if (duree !== 'permanent') {
        let ms = 15000;
        if (duree === 'court') ms = 5000;
        if (duree === 'long') ms = 30000;
        
        timerRef.current = setTimeout(() => {
          onClose();
        }, ms);
      }
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [currentData, animationState, onClose]);

  if (animationState === 'hidden' || !currentData) return null;

  // Calcul des styles de positionnement
  const getPositionStyles = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: 'fixed',
      zIndex: 1000,
      background: 'rgba(10, 10, 14, 0.92)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      backdropFilter: 'blur(20px)',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      overflow: 'hidden',
    };

    const pos = currentData.position || 'centre';
    
    if (pos === 'centre') {
      return {
        ...baseStyle,
        bottom: '136px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'min(500px, 85vw)',
        maxHeight: '55vh',
      };
    }
    if (pos === 'droite') {
      return {
        ...baseStyle,
        top: '60px',
        right: '24px',
        bottom: '100px',
        width: 'min(420px, 42vw)',
      };
    }
    if (pos === 'bas') {
      return {
        ...baseStyle,
        bottom: '130px',
        left: '24px',
        right: '24px',
        height: 'auto',
        maxHeight: '180px',
      };
    }
    if (pos === 'plein_ecran') {
      return {
        ...baseStyle,
        top: '40px',
        left: '20px',
        right: '20px',
        bottom: '100px',
      };
    }

    return baseStyle;
  };

  const parseMarkdown = (text: string) => {
    // Analyse basique du markdown sans bibliothèque externe
    let html = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // Titres ##
    html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
    // Gras **
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italique *
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Code inline `
    html = html.replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px;">$1</code>');
    // Liste -
    html = html.replace(/^- (.*)$/gm, '<li style="margin-left: 20px;">$1</li>');
    // Retours à la ligne
    html = html.replace(/\n/g, '<br/>');

    return { __html: html };
  };

  const renderContent = () => {
    switch (currentData.type) {
      case 'texte':
        return (
          <div style={{ fontSize: '14px', lineHeight: '1.6', color: 'rgba(255, 255, 255, 0.92)' }}>
            {currentData.contenu?.split('\n').map((para, i) => (
              <p key={i} style={{ margin: '0 0 10px 0' }}>{para}</p>
            ))}
          </div>
        );

      case 'code':
        return (
          <div style={{ position: 'relative' }}>
            {currentData.langue && (
              <div style={{ position: 'absolute', top: '0', right: '0', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', fontSize: '10px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
                {currentData.langue}
              </div>
            )}
            <pre style={{ margin: '0', padding: '15px', background: 'rgba(0,0,0,0.4)', overflowX: 'auto', userSelect: 'text' }}>
              <code style={{ fontFamily: '"JetBrains Mono", "Fira Code", monospace', fontSize: '13px', color: 'rgba(255,255,255,0.92)' }}>
                {currentData.contenu}
              </code>
            </pre>
          </div>
        );

      case 'liste':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {currentData.items?.map((item, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                animation: `slideFadeIn 300ms ease-out ${i * 80}ms backwards`
              }}>
                <div style={{
                  width: '4px',
                  height: '100%',
                  minHeight: '20px',
                  background: 'linear-gradient(180deg, #6366f1, #8b5cf6)',
                  marginRight: '12px',
                  flexShrink: 0
                }} />
                <span style={{ fontSize: '14px', color: 'rgba(255,255,255,0.92)', lineHeight: '1.4' }}>{item}</span>
              </div>
            ))}
            <style>
              {`
                @keyframes slideFadeIn {
                  from { opacity: 0; transform: translateX(-10px); }
                  to { opacity: 1; transform: translateX(0); }
                }
              `}
            </style>
          </div>
        );

      case 'etapes':
        return (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {currentData.items?.map((item, i) => {
              const isLast = i === (currentData.items?.length || 0) - 1;
              return (
                <div key={i} style={{ display: 'flex', position: 'relative', paddingBottom: isLast ? '0' : '20px' }}>
                  {!isLast && (
                    <div style={{
                      position: 'absolute',
                      left: '9px',
                      top: '20px',
                      bottom: '0',
                      width: '1px',
                      background: 'rgba(255,255,255,0.1)'
                    }} />
                  )}
                  <div style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '50%',
                    border: '1px solid rgba(255,255,255,0.2)',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    fontSize: '10px',
                    color: isLast ? '#8b5cf6' : 'rgba(255,255,255,0.5)',
                    marginRight: '12px',
                    flexShrink: 0,
                    background: '#0a0a0e',
                    zIndex: 1,
                    boxShadow: isLast ? '0 0 8px rgba(139, 92, 246, 0.4)' : 'none',
                    borderColor: isLast ? '#8b5cf6' : 'rgba(255,255,255,0.2)'
                  }}>
                    {i + 1}
                  </div>
                  <div style={{ fontSize: '14px', color: isLast ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.6)', paddingTop: '1px' }}>
                    {item}
                  </div>
                </div>
              );
            })}
          </div>
        );

      case 'tableau':
        if (!currentData.items || currentData.items.length === 0) return null;
        const [headerRow, ...dataRows] = currentData.items;
        const headers = headerRow.split('|').map(s => s.trim());
        
        return (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', color: 'rgba(255,255,255,0.92)' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {headers.map((h, i) => (
                    <th key={i} style={{ padding: '10px', textAlign: 'left', fontWeight: 'normal', color: 'rgba(255,255,255,0.5)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {row.split('|').map((cell, j) => (
                      <td key={j} style={{ padding: '10px' }}>{cell.trim()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );

      case 'carte':
        return (
          <div style={{ 
            borderLeft: '3px solid',
            borderImage: 'linear-gradient(180deg, #6366f1, #8b5cf6) 1',
            padding: '12px 16px',
            background: 'rgba(255,255,255,0.02)'
          }}>
            {currentData.titre && <div style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '8px', color: 'rgba(255,255,255,0.92)' }}>{currentData.titre}</div>}
            <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', lineHeight: '1.5' }}>
              {currentData.contenu}
            </div>
          </div>
        );

      case 'markdown':
        return (
          <div 
            style={{ fontSize: '14px', lineHeight: '1.6', color: 'rgba(255,255,255,0.92)' }}
            dangerouslySetInnerHTML={currentData.contenu ? parseMarkdown(currentData.contenu) : { __html: '' }} 
          />
        );

      case 'image_url':
        return (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <img 
              src={currentData.contenu} 
              alt={currentData.titre || 'Visual content'} 
              style={{ objectFit: 'contain', maxWidth: '100%', maxHeight: '400px' }}
            />
          </div>
        );

      default:
        return null;
    }
  };

  const baseStyle = getPositionStyles();
  const transitionStyle: React.CSSProperties = {
    transition: 'all 350ms ease-out',
    opacity: (animationState === 'visible' || animationState === 'entering') ? 1 : 0,
    transform: baseStyle.transform 
      ? (animationState === 'visible' || animationState === 'entering' ? baseStyle.transform : `${baseStyle.transform} translateY(12px)`)
      : (animationState === 'visible' || animationState === 'entering' ? 'translateY(0)' : 'translateY(12px)')
  };
  
  if (animationState === 'exiting') {
    transitionStyle.transition = 'opacity 250ms ease';
    transitionStyle.opacity = 0;
  }

  // Styles de la scrollbar personnalisée pour le conteneur de contenu
  const contentContainerStyle: React.CSSProperties = {
    padding: '20px',
    overflowY: 'auto',
    flex: 1,
  };

  return (
    <>
      <style>
        {`
          .custom-scrollbar::-webkit-scrollbar {
            width: 4px;
            height: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
          }
        `}
      </style>
      <div 
        className="window-no-drag"
        style={{ ...baseStyle, ...transitionStyle }}
      >
        {/* En-tête avec titre et bouton de fermeture */}
        {(currentData.titre && currentData.type !== 'carte' && currentData.type !== 'image_url') && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div style={{
              fontSize: '13px',
              textTransform: 'uppercase',
              letterSpacing: '2px',
              color: 'rgba(255,255,255,0.5)',
            }}>
              {currentData.titre}
            </div>
            
            <button 
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.5)',
                cursor: 'pointer',
                width: '20px',
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                fontSize: '16px',
                lineHeight: 1
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Bouton de fermeture alternatif s'il n'y a pas d'en-tête */}
        {(!currentData.titre || currentData.type === 'carte' || currentData.type === 'image_url') && (
          <button 
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              background: 'transparent',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              cursor: 'pointer',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              fontSize: '16px',
              lineHeight: 1,
              zIndex: 10,
            }}
          >
            ×
          </button>
        )}

        <div className="custom-scrollbar" style={contentContainerStyle}>
          {renderContent()}
        </div>
      </div>
    </>
  );
};

export default VisualCanvas;
