import { useEffect, useState } from 'react';
export function StorageStatus() {
  const [text, setText] = useState('Checking browser storage…');
  useEffect(() => {
    let active = true;
    if (!navigator.storage?.estimate) {
      setText('This browser does not report storage capacity.');
      return;
    }
    void navigator.storage
      .estimate()
      .then((estimate) => {
        if (active)
          setText(
            `Approximate storage: ${((estimate.usage ?? 0) / 1048576).toFixed(1)} MB used of ${((estimate.quota ?? 0) / 1048576).toFixed(0)} MB available to this site.`,
          );
      })
      .catch(() => {
        if (active) setText('Storage capacity could not be checked.');
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <p className="help" aria-live="polite">
      {text} Browser storage may be evicted. Keep portable backups of important work.
    </p>
  );
}
