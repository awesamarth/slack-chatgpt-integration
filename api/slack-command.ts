import { VercelRequest, VercelResponse } from '@vercel/node';
import { SlackCommandPayload, ThreadData } from '../types';
import { 
  verifySlackRequest, 
  getThreadMessages, 
  saveChatSession, 
  generateChatId 
} from '../utils';
import { sendThreadToChatGPT } from '../openai';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Log incoming request
  console.log('Received request:', {
    method: req.method,
    headers: req.headers,
    body: req.body,
    url: req.url
  });

  // Only accept POST requests
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).send('Method Not Allowed');
  }

  try {
    console.log('Processing POST request');
    
    // Log all environment variables to check if they're available
    console.log('Environment check:', {
      SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET ? 'exists' : 'missing',
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ? 'exists' : 'missing',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'exists' : 'missing'
    });

    // Verify that the request is coming from Slack
    const slackSignature = req.headers['x-slack-signature'] as string;
    const slackTimestamp = req.headers['x-slack-request-timestamp'] as string;
    const rawBody = JSON.stringify(req.body);
    
    console.log('Slack headers check:', {
      signature: slackSignature ? 'exists' : 'missing',
      timestamp: slackTimestamp ? 'exists' : 'missing'
    });
    
    if (!process.env.SLACK_SIGNING_SECRET) {
      console.error('SLACK_SIGNING_SECRET is not set');
      throw new Error('SLACK_SIGNING_SECRET is not set');
    }
    
    
    console.log('Signature verification bypassed for debugging');

    // Parse Slack command payload
    const payload = req.body as SlackCommandPayload;
    console.log('Slack payload:', payload);
    
    console.log('Sending initial acknowledgment');
    return res.status(200).json({
      response_type: 'in_channel',
      text: 'Processing your request...'
    });
    
    // Check if we're in a thread
    if (!payload.thread_ts) {
      console.log('Not in a thread - sending error response');
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'This command must be used within a thread.'
      });
      return;
    }
    
    // Get chat_id from command text or generate a new one
    const chatId = payload.text.trim() || generateChatId();
    console.log('Using chat ID:', chatId);
    
    // Fetch thread messages
    console.log('Fetching thread messages from channel:', payload.channel_id, 'thread:', payload.thread_ts);
    //@ts-ignore
    const messages = await getThreadMessages(payload.channel_id, payload.thread_ts);
    console.log('Fetched messages count:', messages.length);
    
    if (messages.length === 0) {
      console.log('No messages found in thread');
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'No messages found in this thread.'
      });
      return;
    }
    
    // Create thread data
    const threadData: ThreadData = {
      messages,
      channelId: payload.channel_id,
          //@ts-ignore

      threadTs: payload.thread_ts
    };
    
    // Save the chat session
    console.log('Saving chat session');
        //@ts-ignore

    await saveChatSession(chatId, payload.channel_id, payload.thread_ts);
    
    // Send thread to ChatGPT
    console.log('Sending thread to ChatGPT');
    const response = await sendThreadToChatGPT(chatId, threadData);
    console.log('Received response from ChatGPT');
    
    // Send the response back to Slack
    console.log('Sending response back to Slack');
    await axios.post(payload.response_url, {
      response_type: 'in_channel',
      text: `*ChatGPT Response:*\n\n${response}\n\n_To continue this conversation, use \`/chatgpt ${chatId}\` in another thread._`
    });
    console.log('Successfully sent response to Slack');
    
  } catch (error) {
    console.error('Error handling slack command:', error);
    
    // If we've already sent a 200 response, we need to use the response_url
    if (req.body && req.body.response_url) {
      console.log('Sending error response via response_url');
      await axios.post(req.body.response_url, {
        response_type: 'ephemeral',
        text: 'An error occurred while processing your request.'
      });
    } else {
      // Otherwise, we can respond directly
      console.log('Sending error response directly');
      res.status(500).send('An error occurred while processing your request.');
    }
  }
}