import { useEffect, useState } from 'react';

export function QRCode({
  value,
  size = 200,
  className,
  dark = '#0b0b0f',
  light = '#ffffff',
}: {
  value: string;
  size?: number;
  className?: string;
  dark?: string;
  light?: string;
}) {
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    let alive = true;
    import('qrcode').then(({ toString }) =>
      toString(value, {
        type: 'svg',
        width: size,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: dark + 'ff', light: light + 'ff' },
      }).then((s: string) => {
        if (alive) setSvg(s);
      })
    );
    return () => {
      alive = false;
    };
  }, [value, size, dark, light]);

  return (
    <div
      className={className}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-label={`QR code for ${value}`}
      role="img"
    />
  );
}
