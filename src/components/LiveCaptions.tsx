import React, { useState, useEffect, useRef } from 'react';

interface LiveCaptionsProps {
  text: string;
  isVisible: boolean;
  className?: string;
}

const LiveCaptions: React.FC<LiveCaptionsProps> = ({ text, isVisible, className = '' }) => {
  // Texte actuellement affiché
  const [displayText, setDisplayText] = useState('');
  // Gère l'opacité pour l'animation de fondu
  const [show, setShow] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Mettre à jour l'affichage en fonction du texte
  useEffect(() => {
    if (!text) return;

    let currentSentence = text;
    
    // Trouver la dernière ponctuation de fin de phrase
    const lastPunct = Math.max(
      text.lastIndexOf('.'), 
      text.lastIndexOf('!'), 
      text.lastIndexOf('?')
    );
    
    // Extraire uniquement la phrase en cours ou la dernière phrase terminée
    if (lastPunct !== -1) {
      // Si la ponctuation est à la toute fin, on récupère la phrase qui vient de se terminer
      if (lastPunct >= text.length - 2) {
        const textBeforeLastPunct = text.substring(0, lastPunct);
        const prevPunct = Math.max(
          textBeforeLastPunct.lastIndexOf('.'), 
          textBeforeLastPunct.lastIndexOf('!'), 
          textBeforeLastPunct.lastIndexOf('?')
        );
        currentSentence = text.substring(prevPunct + 1).trim();
      } else {
        // Une nouvelle phrase a commencé, on n'affiche que celle-ci
        currentSentence = text.substring(lastPunct + 1).trim();
      }
    }

    // Limiter à ~150 caractères maximum (tronquer au début si nécessaire)
    if (currentSentence.length > 150) {
      currentSentence = "..." + currentSentence.substring(currentSentence.length - 147);
    }

    setDisplayText(currentSentence);
  }, [text]);

  // Gérer l'animation d'apparition et de disparition
  useEffect(() => {
    if (isVisible) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setShow(true);
    } else {
      setShow(false);
      // Nettoyer le texte après la transition de disparition (500ms)
      timeoutRef.current = setTimeout(() => {
        setDisplayText('');
      }, 500);
    }
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isVisible]);

  // Styles du composant : design sombre, minimaliste, sans bords arrondis
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '80px', // Placé au-dessus de la pilule de statut
    left: '50%',
    transform: 'translateX(-50%)',
    maxWidth: '80%',
    padding: '8px 16px',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)', // Support Safari
    borderRadius: 0, // Bords droits stricts
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: '14px',
    fontWeight: 400,
    textAlign: 'center',
    opacity: show && displayText ? 1 : 0,
    transition: `opacity ${isVisible ? '300ms' : '500ms'} ease-in-out`,
    pointerEvents: 'none',
    zIndex: 100,
  };

  return (
    <div style={containerStyle} className={className}>
      {displayText}
    </div>
  );
};

export default LiveCaptions;
