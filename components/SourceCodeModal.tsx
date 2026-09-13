import React from 'react';

interface Props {
  onClose: () => void;
}

// Compatibility shim while App.tsx is kept untouched.
// The legacy in-app source viewer/export feature has been retired.
const SourceCodeModal: React.FC<Props> = () => null;

export default SourceCodeModal;
