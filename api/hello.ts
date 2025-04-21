import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Log incoming request
  console.log('Received hello request:', {
    method: req.method,
    url: req.url,
    headers: req.headers
  });

  // Only accept POST requests
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).send('Method Not Allowed');
  }

  try {
    console.log('Processing /hello command');
    console.log('Request body:', req.body);

    // Simple response - no complex processing or verification
    return res.status(200).json({
      response_type: 'in_channel', // Makes response visible to everyone in channel
      text: 'Hello! 👋 This is a simple test response from your Slack app.'
    });
    
  } catch (error) {
    console.error('Error handling hello command:', error);
    return res.status(500).json({
      response_type: 'ephemeral', // Only visible to the user who issued the command
      text: 'Sorry, something went wrong with the hello command.'
    });
  }
}