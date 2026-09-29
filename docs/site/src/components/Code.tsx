import { useState } from 'react';

export function Pre({
  lang,
  children,
  className,
}: {
  lang?: string;
  children: string;
  className?: string;
}) {
  const [ok, setOk] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(children).then(() => {
      setOk(true);
      setTimeout(() => setOk(false), 1400);
    });
  };

  return (
    <pre className={'spec-pre ' + (className ?? '')} data-lang={lang ?? 'text'}>
      <code>{children}</code>
      <button type="button" className={'copy-btn ' + (ok ? 'ok' : '')} onClick={copy}>
        {ok ? 'Copied' : 'Copy'}
      </button>
    </pre>
  );
}
