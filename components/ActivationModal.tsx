import React from 'react';

interface ActivationModalProps {
  isActivated?: boolean;
  isOpen?: boolean;
  onClose?: () => void;
  onActivated: () => void;
}

// Compatibility shim while App.tsx is kept untouched.
// Identity verification and activation-lock functionality has been retired.
export const ActivationModal: React.FC<ActivationModalProps> = () => null;
