import { APIGatewayProxyHandler } from 'aws-lambda';
import * as QRCode from 'qrcode';

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    const { text, size = 200 } = JSON.parse(event.body || '{}');

    if (!text) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({ error: 'text parameter is required' })
      };
    }

    // Generate the QR code locally as a data URI - no third-party service
    const qrCodeUrl = await QRCode.toDataURL(text, { width: size, margin: 1 });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        qrCodeUrl,
        text,
        size
      })
    };
  } catch (error) {
    console.error('Error generating QR code:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
