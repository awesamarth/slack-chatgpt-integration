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

// Function to parse thread link or ID
function parseThreadInfo(input: string): { channelId: string, threadTs: string } | null {
  try {
    // Handle full Slack URL
    if (input.includes('/archives/')) {
      const archivePart = input.split('/archives/')[1];
      const parts = archivePart.split('/');
      if (parts.length >= 2) {
        const channelId = parts[0];
        // Convert pXXXXXXXXXX format to X.XXXXXX format that Slack API expects
        let threadTs = parts[1];
        if (threadTs.startsWith('p')) {
          const tsNumber = threadTs.substring(1);
          threadTs = `${tsNumber.substring(0, 10)}.${tsNumber.substring(10)}`;
        }
        return { channelId, threadTs };
      }
    }
    // Handle just the part after /archives/
    else if (input.includes('/')) {
      const parts = input.split('/');
      if (parts.length >= 2) {
        const channelId = parts[0];
        // Convert pXXXXXXXXXX format to X.XXXXXX format
        let threadTs = parts[1];
        if (threadTs.startsWith('p')) {
          const tsNumber = threadTs.substring(1);
          threadTs = `${tsNumber.substring(0, 10)}.${tsNumber.substring(10)}`;
        }
        return { channelId, threadTs };
      }
    }
    return null;
  } catch (error) {
    console.error('Error parsing thread info:', error);
    return null;
  }
}

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
    res.status(200).json({
      response_type: 'in_channel',
      text: 'Processing your request...'
    });

    // Parse the command text to get thread link and optional chat ID
    const params = payload.text.trim().split(/\s+/);
    let threadLink = '';
    let chatId = '';
    
    if (params.length >= 1) {
      threadLink = params[0];
    }
    
    if (params.length >= 2) {
      chatId = params[1];
    }
    
    // If no thread link provided, return error
    if (!threadLink) {
      console.log('No thread link provided');
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'Please provide a thread link. Usage: `/chatgpt <thread_link> [chat_id]`'
      });
      return;
    }
    
    // Parse thread info from link
    const threadInfo = parseThreadInfo(threadLink);
    if (!threadInfo) {
      console.log('Invalid thread link format');
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'Invalid thread link format. Please provide a valid Slack thread link.'
      });
      return;
    }
    
    console.log('Parsed thread info:', threadInfo);
    
    // Generate chat ID if not provided
    if (!chatId) {
      chatId = generateChatId();
      console.log('Generated new chat ID:', chatId);
    } else {
      console.log('Using provided chat ID:', chatId);
    }
    
    // Fetch thread messages
    console.log('Fetching thread messages from channel:', threadInfo.channelId, 'thread:', threadInfo.threadTs);
    const messages = await getThreadMessages(threadInfo.channelId, threadInfo.threadTs);
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
      channelId: threadInfo.channelId,
      threadTs: threadInfo.threadTs
    };
    
    // Save the chat session
    console.log('Saving chat session');
    await saveChatSession(chatId, threadInfo.channelId, threadInfo.threadTs);
    
    // Send thread to ChatGPT
    console.log('Sending thread to ChatGPT');
    const response = await sendThreadToChatGPT(chatId, threadData);
    console.log('Received response from ChatGPT');
    
    // Send the response back to Slack
    console.log('Sending response back to Slack');
    await axios.post(payload.response_url, {
      response_type: 'in_channel',
      text: `*ChatGPT Response:*\n\n${response}\n\n_Chat ID: \`${chatId}\` - To continue this conversation, use \`/chatgpt <thread_link> ${chatId}\` with another thread._`
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