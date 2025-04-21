///@ts-nocheck
 
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
    
    // Parse Slack command payload
    const payload = req.body;
    console.log('Command text:', payload.text);
    
    // Send immediate acknowledgment
    res.status(200).json({
      response_type: 'in_channel',
      text: 'Fetching thread content...'
    });
    
    // Get thread link from command text
    const threadLink = payload.text?.trim();
    
    if (!threadLink) {
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'Please provide a thread link. Usage: `/fetch-thread <thread_link>`'
      });
      return;
    }
    
    // Parse thread link
    console.log('Parsing thread link:', threadLink);
    const threadInfo = parseThreadLink(threadLink);
    
    if (!threadInfo) {
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: 'Invalid thread link format. Please provide a valid Slack thread link.'
      });
      return;
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
        await axios.post(payload.response_url, {
          response_type: 'ephemeral',
          text: 'No messages found in this thread.'
        });
        return;
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
      
      // Send response back to Slack
      await axios.post(payload.response_url, {
        response_type: 'in_channel',
        text: formattedText
      });
      
      console.log('Successfully sent thread content to Slack');
      
    } catch (error) {
      console.error('Error fetching thread messages:', error);
      
      // Send error back to Slack
      await axios.post(payload.response_url, {
        response_type: 'ephemeral',
        text: `Error fetching thread messages: ${error.message || 'Unknown error'}`
      });
    }
    
  } catch (error) {
    console.error('Error handling command:', error);
    
    // Try to send error response to Slack
    if (req.body && req.body.response_url) {
      await axios.post(req.body.response_url, {
        response_type: 'ephemeral',
        text: `Error: ${error.message || 'Unknown error'}`
      });
    }
  }
}