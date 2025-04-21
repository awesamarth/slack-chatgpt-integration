//@ts-nocheck
import { VercelRequest, VercelResponse } from '@vercel/node';
import { WebClient } from '@slack/web-api';
import axios from 'axios';

// Initialize Slack client
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Parse thread link
function parseThreadLink(link: string): { channelId: string, threadTs: string } | null {
  try {
    // Handle full Slack URL
    if (link.includes('/archives/')) {
      const archivePart = link.split('/archives/')[1];
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
    else if (link.includes('/')) {
      const parts = link.split('/');
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
    console.error('Error parsing thread link:', error);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    console.log('Thread fetch request received');
    console.log("token is here: ", process.env.SLACK_BOT_TOKEN)

    
    // Parse Slack command payload
    const payload = req.body;
    const text = payload.text || '';
    const responseUrl = payload.response_url;
    
    console.log('Command text:', text);
    console.log('Response URL:', responseUrl ? 'exists' : 'missing');
    
    // Process thread link
    const threadLink = text.trim();
    
    if (!threadLink) {
      console.log('No thread link provided');
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'Please provide a thread link. Usage: `/fetch-thread <thread_link>`'
      });
    }
    
    // Parse thread link
    console.log('Parsing thread link:', threadLink);
    const threadInfo = parseThreadLink(threadLink);
    
    if (!threadInfo) {
      console.log('Invalid thread link format');
      return res.status(200).json({
        response_type: 'ephemeral',
        text: 'Invalid thread link format. Please provide a valid Slack thread link.'
      });
    }
    
    console.log('Thread info:', threadInfo);
    
    // Fetch thread messages
    try {
      console.log(`Fetching messages for channel: ${threadInfo.channelId}, thread: ${threadInfo.threadTs}`);
      
      const response = await slackClient.conversations.replies({
        channel: threadInfo.channelId,
        ts: threadInfo.threadTs, 
      });
      
      if (!response.messages || response.messages.length === 0) {
        console.log('No messages found in thread');
        return res.status(200).json({
          response_type: 'ephemeral',
          text: 'No messages found in this thread.'
        });
      }
      
      console.log(`Found ${response.messages.length} messages in thread`);
      
      // Format the response
      let formattedText = `*Found ${response.messages.length} messages in thread:*\n\n`;
      
      for (const msg of response.messages) {
        const user = msg.username || msg.user || 'Unknown user';
        formattedText += `*${user}:* ${msg.text}\n\n`;
        
        // Keep the response under Slack's message limit (4000 chars to be safe)
        if (formattedText.length > 3500) {
          formattedText += '... (message truncated due to length)';
          break;
        }
      }
      
      console.log('Sending formatted thread content response');
      return res.status(200).json({
        response_type: 'in_channel',
        text: formattedText
      });
      
    } catch (error) {
      console.error('Error fetching thread messages:', error);
      return res.status(200).json({
        response_type: 'ephemeral',
        text: `Error fetching thread messages: ${error.message || 'Unknown error'}`
      });
    }
    
  } catch (error) {
    console.error('Error handling command:', error);
    return res.status(200).json({
      response_type: 'ephemeral',
      text: `Error: ${error.message || 'Unknown error'}`
    });
  }
}