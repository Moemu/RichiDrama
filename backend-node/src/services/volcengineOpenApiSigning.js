'use strict';

const crypto = require('node:crypto');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function encodeRFC3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Signs the JSON POST / control-plane requests used by Ark and billing. */
function signOpenApiRequest({
  accessKeyId, secretAccessKey, region, service, action, version, body,
  host = 'open.volcengineapi.com', projectName, sessionToken, date = new Date(),
}) {
  const bodyText = JSON.stringify(body || {});
  const payloadHash = sha256(bodyText);
  const xDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = xDate.slice(0, 8);
  const params = { Action: action, Version: version };
  if (projectName) params.ProjectName = projectName;
  const query = Object.keys(params).sort()
    .map((key) => `${encodeRFC3986(key)}=${encodeRFC3986(params[key])}`).join('&');

  // Match the existing SDK requests: content-type and implicit host are not signed.
  const signedValues = [['x-content-sha256', payloadHash], ['x-date', xDate]];
  if (sessionToken) signedValues.push(['x-security-token', sessionToken]);
  const signedHeaders = signedValues.map(([key]) => key).join(';');
  const canonicalHeaders = signedValues
    .map(([key, value]) => `${key}:${value.replace(/\s+/g, ' ').trim()}\n`).join('');
  const canonicalRequest = `POST\n/\n${query}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = `HMAC-SHA256\n${xDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(secretAccessKey, shortDate);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'request');
  const signature = hmac(signingKey, stringToSign).toString('hex');

  return {
    url: `https://${host}/?${query}`,
    bodyText,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Sha256': payloadHash,
      'X-Date': xDate,
      ...(sessionToken ? { 'X-Security-Token': sessionToken } : {}),
      Authorization: `HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

module.exports = { signOpenApiRequest };
