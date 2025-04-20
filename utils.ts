import { WebClient } from '@slack/web-api';
import { kv } from '@vercel/kv';
import { ChatSession, ThreadData, ThreadMessage } from './types';
import crypto from 'crypto';

// Initialize Slack client
export const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

// Generate a unique chat ID
export function generateChatId(): string {
  return crypto.randomBytes(8).toString('hex');
}

// Verify Slack request signature
export function verifySlackRequest(
  signingSecret: string,
  requestSignature: string,
  timestamp: string,
  body: string
): boolean {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const computedSignature = `v0=${hmac}`;
  
  return crypto.timingSafeEqual(
    Buffer.from(computedSignature),
    Buffer.from(requestSignature)
  );
}

// Fetch thread messages from Slack
export async function getThreadMessages(channelId: string, threadTs: string): Promise<ThreadMessage[]> {
  try {
    const response = await slackClient.conversations.replies({
      channel: channelId,
      ts: threadTs,
    });

    if (!response.messages || response.messages.length === 0) {
      return [];
    }

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

// Save chat session to database
export async function saveChatSession(chatId: string, channelId: string, threadTs: string): Promise<void> {
  try {
    // Check if session already exists
    const existingSession = await kv.get<ChatSession>(`chat:${chatId}`);
    
    if (existingSession) {
      // Update existing session
      const threadExists = existingSession.threads.some(
        t => t.channelId === channelId && t.threadTs === threadTs
      );
      
      if (!threadExists) {
        existingSession.threads.push({ channelId, threadTs });
        existingSession.updatedAt = Date.now();
        await kv.set(`chat:${chatId}`, existingSession);
      }
    } else {
      // Create new session
      const newSession: ChatSession = {
        id: chatId,
        threads: [{ channelId, threadTs }],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await kv.set(`chat:${chatId}`, newSession);
    }
  } catch (error) {
    console.error('Error saving chat session:', error);
    throw error;
  }
}

// Get chat session from database
export async function getChatSession(chatId: string): Promise<ChatSession | null> {
  try {
    return await kv.get<ChatSession>(`chat:${chatId}`);
  } catch (error) {
    console.error('Error getting chat session:', error);
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