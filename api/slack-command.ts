import { VercelRequest, VercelResponse } from '@vercel/node';
import { SlackCommandPayload, ThreadData } from '../types';
import { parseThreadLink, getThreadMessages, generateChatId } from '../utils';
import { sendThreadToChatGPT } from '../openai';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    console.log('Processing /chatgpt command');
    
    // Log environment variables availability (not values)
    console.log('Environment check:', {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ? 'exists' : 'missing',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'exists' : 'missing'
    });

    // Parse Slack command payload
    const payload = req.body as SlackCommandPayload;
    console.log('Command text:', payload.text);
    
    // Send immediate acknowledgment
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
    const threadInfo = parseThreadLink(threadLink);
    if (!threadInfo) {
      console.log('Invalid thread link format');
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'Invalid thread link format. Please provide a valid Slack thread link.'
      });
      return;
    }
    
    console.log('Thread info:', threadInfo);
    
    // Generate chat ID if not provided
    if (!chatId) {
      chatId = generateChatId();
      console.log('Generated new chat ID:', chatId);
    } else {
      console.log('Using provided chat ID:', chatId);
    }
    
    // Fetch thread messages
    console.log(`Fetching thread messages from channel: ${threadInfo.channelId}, thread: ${threadInfo.threadTs}`);
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