import React from 'react';
import IdempotencySim from './ops/IdempotencySim';

/**
 * 05 · Safe retries. Folds the former operations page's idempotency lesson
 * into the main guide, right after "Kill a cell" — because failover means
 * retries, and a retry is the same command arriving twice.
 */
const Idempotency: React.FC = () => (
  <section className="lesson" id="idempotency">
    <div className="kicker">05 · Safe retries</div>
    <h2>Retry without double-charging</h2>
    <p data-testid="section-lede">
      A failover retry is the same command arriving twice — and the client can't know whether the
      first landed. The fix: hash the request and let the repeat find the first attempt's record.{' '}
      <strong>Same key, one effect</strong> — but only if both sides can <em>see</em> the record: a
      global table protects exactly as far as replication has reached.
    </p>
    <p>
      You built this exact failure one lesson ago: kill a cell, and every one of its clients
      lands somewhere new and tries again. Here is what that retry does to a payment:
    </p>
    <IdempotencySim />
    <div className="callout">
      <strong>In production you don't hand-roll this.</strong>{' '}
      <a href="https://docs.powertools.aws.dev/lambda/python/latest/utilities/idempotency/" target="_blank" rel="noopener noreferrer">
        AWS Lambda Powertools' idempotency utility
      </a>{' '}
      implements the whole record dance as a decorator over your handler, with DynamoDB as the
      store. The AWS demo wires it to a <em>global</em> table so one record protects both regions —
      and to isolated tables so you can watch the guarantee disappear.
    </div>
  </section>
);

export default Idempotency;
