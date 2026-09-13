import React from 'react';

interface Props {
  isOpen: boolean;
  onSuccess: () => void;
  isLocked?: boolean;
  onClose?: () => void;
}

// Compatibility shim while App.tsx is kept untouched.
// Subscription and payment UI has been retired.
const SubscriptionModal: React.FC<Props> = () => null;

export default SubscriptionModal;
