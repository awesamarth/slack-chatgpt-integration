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
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // Verify that the request is coming from Slack
    const slackSignature = req.headers['x-slack-signature'] as string;
    const slackTimestamp = req.headers['x-slack-request-timestamp'] as string;
    const rawBody = JSON.stringify(req.body);
    
    if (!process.env.SLACK_SIGNING_SECRET) {
      throw new Error('SLACK_SIGNING_SECRET is not set');
    }
    
    const isValidRequest = verifySlackRequest(
      process.env.SLACK_SIGNING_SECRET,
      slackSignature,
      slackTimestamp,
      rawBody
    );
    
    if (!isValidRequest) {
      return res.status(401).send('Unauthorized');
    }

    // Parse Slack command payload
    const payload = req.body as SlackCommandPayload;
    
    // Acknowledge the command quickly to prevent timeout
    res.status(200).send({
      response_type: 'in_channel',
      text: 'Processing your request, please wait...'
    });
    
    // Check if we're in a thread
    if (!payload.thread_ts) {
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'This command must be used within a thread.'
      });
      return;
    }
    
    // Get chat_id from command text or generate a new one
    const chatId = payload.text.trim() || generateChatId();
    
    // Fetch thread messages
    const messages = await getThreadMessages(payload.channel_id, payload.thread_ts);
    
    if (messages.length === 0) {
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
      threadTs: payload.thread_ts
    };
    
    // Save the chat session
    await saveChatSession(chatId, payload.channel_id, payload.thread_ts);
    
    // Send thread to ChatGPT
    const response = await sendThreadToChatGPT(chatId, threadData);
    
    // Send the response back to Slack
    await axios.post(payload.response_url, {
      response_type: 'in_channel',
      text: `*ChatGPT Response:*\n\n${response}\n\n_To continue this conversation, use \`/chatgpt ${chatId}\` in another thread._`
    });
    
  } catch (error) {
    console.error('Error handling slack command:', error);
    
    // If we've already sent a 200 response, we need to use the response_url
    if (req.body && req.body.response_url) {
      await axios.post(req.body.response_url, {
        response_type: 'ephemeral',
        text: 'An error occurred while processing your request.'
      });
    } else {
      // Otherwise, we can respond directly
      res.status(500).send('An error occurred while processing your request.');
    }
  }
}