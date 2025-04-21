import { WebClient } from '@slack/web-api';
import { ThreadData, ThreadMessage } from './types';
import crypto from 'crypto';

// Initialize Slack client
export const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Generate a unique chat ID
export function generateChatId(): string {
  return crypto.randomBytes(4).toString('hex');
}

// Parse thread link to get channel ID and thread timestamp
export function parseThreadLink(link: string): { channelId: string, threadTs: string } | null {
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

// Fetch thread messages from Slack
export async function getThreadMessages(channelId: string, threadTs: string): Promise<ThreadMessage[]> {
  try {
    console.log(`Fetching messages for channel: ${channelId}, thread: ${threadTs}`);
    
    const response = await slackClient.conversations.replies({
      channel: channelId,
      ts: threadTs,
    });

    if (!response.messages || response.messages.length === 0) {
      console.log('No messages found in thread');
      return [];
    }

    console.log(`Found ${response.messages.length} messages in thread`);
    
    return response.messages.map(msg => {
      // Create a base message object
      const messageObj: ThreadMessage = {
        user: msg.user || 'unknown',
        text: msg.text || '',
        ts: msg.ts || ''
      };
      
      // For bot messages or messages with a username, add it to our object
      if ('username' in msg) {
        messageObj.username = msg.username as string;
      }
      
      return messageObj;
    });
  } catch (error) {
    console.error('Error fetching thread messages:', error);
    throw error;
  }
}

// Format thread data for ChatGPT
export function formatThreadForChatGPT(threadData: ThreadData): string {
  const messages = threadData.messages;
  let formattedText = `--- SLACK THREAD CONTENT ---\n\n`;
  
  for (const message of messages) {
    const username = message.username || `User (${message.user})`;
    formattedText += `${username}: ${message.text}\n\n`;
  }
  
  formattedText += `--- END OF SLACK THREAD ---`;
  return formattedText;
}