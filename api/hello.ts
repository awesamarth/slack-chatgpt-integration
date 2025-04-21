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

  let responseUrl = '';

  try {
    console.log('Request received:', {
      method: req.method,
      headers: Object.keys(req.headers),
      body: req.body ? Object.keys(req.body) : 'no body'
    });
    
    // Log environment variables availability (not values)
    console.log('Environment check:', {
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ? 'exists' : 'missing',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'exists' : 'missing'
    });

    // Parse Slack command payload
    const payload = req.body as SlackCommandPayload;
    responseUrl = payload.response_url;
    
    console.log('Slack payload:', {
      command: payload.command,
      text: payload.text,
      channel_id: payload.channel_id,
      user_id: payload.user_id,
      response_url: payload.response_url ? 'exists' : 'missing'
    });
    
    // Send immediate acknowledgment
    res.status(200).json({
      response_type: 'in_channel',
      text: 'Processing your request...'
    });

    // All processing after the response below:
    await processCommand(payload);
    
  } catch (error) {
    console.error('Error in main handler:', error);
    
    // Try to send error response to Slack if we have a response_url
    if (responseUrl) {
      try {
        await axios.post(responseUrl, {
          response_type: 'ephemeral',
          text: 'An error occurred while processing your request. Please check server logs.'
        });
      } catch (postError) {
        console.error('Error sending error response to Slack:', postError);
      }
    }
  }
}

async function processCommand(payload: SlackCommandPayload) {
  try {
    // Parse the command text to get thread link and optional chat ID
    const params = payload.text.trim().split(/\s+/);
    console.log('Command parameters:', params);
    
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
    console.log('Parsing thread link:', threadLink);
    const threadInfo = parseThreadLink(threadLink);
    if (!threadInfo) {
      console.log('Invalid thread link format');
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'Invalid thread link format. Please provide a valid Slack thread link.'
      });
      return;
    }
    
    console.log('Thread info parsed successfully:', threadInfo);
    
    // Generate chat ID if not provided
    if (!chatId) {
      chatId = generateChatId();
      console.log('Generated new chat ID:', chatId);
    } else {
      console.log('Using provided chat ID:', chatId);
    }
    
    // Fetch thread messages
    console.log(`Fetching thread messages from channel: ${threadInfo.channelId}, thread: ${threadInfo.threadTs}`);
    try {
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
      try {
        const response = await sendThreadToChatGPT(chatId, threadData);
        console.log('Received response from ChatGPT, length:', response.length);
        
        // Send the response back to Slack
        console.log('Sending response back to Slack');
        try {
          await axios.post(payload.response_url, {
            response_type: 'in_channel',
            text: `*ChatGPT Response:*\n\n${response}\n\n_Chat ID: \`${chatId}\` - To continue this conversation, use \`/chatgpt <thread_link> ${chatId}\` with another thread._`
          });
          console.log('Successfully sent response to Slack');
        } catch (postError) {
          console.error('Error posting response to Slack:', postError);
          throw postError;
        }
      } catch (openaiError) {
        console.error('Error from ChatGPT:', openaiError);
        throw openaiError;
      }
    } catch (fetchError) {
      console.error('Error fetching thread messages:', fetchError);
      throw fetchError;
    }
  } catch (error) {
    console.error('Error in process command:', error);
    // Propagate the error back to the main handler
    await axios.post(payload.response_url, {
      response_type: 'ephemeral',
      //@ts-ignore
      text: `Error processing command: ${error.message || 'Unknown error'}`
    });
    throw error;
  }
}