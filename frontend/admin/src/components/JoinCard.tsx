import React, { useState, useEffect } from 'react';

/**
 * "Scan to join" card: one QR code for the whole audience, encoding the
 * ROUTER page URL (not a specific cell) so every phone that scans it gets
 * routed to its own cell by the consistent hash.
 *
 * The router URL comes from the optional ROUTER_URL build-time env (webpack
 * DefinePlugin - deploy-frontend.sh sets it in edge mode where all traffic
 * shares one hostname). When unset it falls back to the router page on this
 * same host: deploy-frontend.sh uploads frontend/router/index.html to the
 * admin bucket as /router.html, so no extra deploy config is needed.
 */
const JoinCard: React.FC<{ apiUrl: string }> = ({ apiUrl }) => {
  const routerUrl = process.env.ROUTER_URL || `${window.location.origin}/router.html`;
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!apiUrl) return undefined;
    let cancelled = false;
    (async () => {
      try {
        // Same backend generator the per-cell QR codes use; it accepts any
        // text and returns a data-URI image (no third-party service).
        const response = await fetch(`${apiUrl}/qr-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: routerUrl, size: 640 }),
        });
        const data = await response.json();
        if (!cancelled && data.qrCodeUrl) {
          setQrCodeUrl(data.qrCodeUrl);
        } else if (!cancelled) {
          setFailed(true);
        }
      } catch (error) {
        console.error('Failed to generate join QR code:', error);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, routerUrl]);

  return (
    <section className="section">
      <div className="kicker">Audience</div>
      <h2>Scan to join the demo</h2>
      <p className="lede">
        One QR code for the whole room: it opens the router page, which hashes each
        phone&apos;s client ID onto the ring and sends it to its own cell.
      </p>
      <div className="panel join-card">
        {qrCodeUrl ? (
          <img className="join-qr" src={qrCodeUrl} alt={`QR code for ${routerUrl}`} />
        ) : (
          <div className="join-qr join-qr-placeholder" role="status">
            {failed ? 'QR generation unavailable' : 'Generating QR code…'}
          </div>
        )}
        <a className="join-url" href={routerUrl} target="_blank" rel="noopener noreferrer">
          {routerUrl}
        </a>
        <p className="join-hint">Same ID, same cell — every scan is routed independently.</p>
      </div>
    </section>
  );
};

export default JoinCard;
