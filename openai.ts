import OpenAI from 'openai';
import { ThreadData } from './types';
import { formatThreadForChatGPT } from './utils';

// In-memory storage for chat contexts
const chatContexts: Record<string, Array<OpenAI.Chat.ChatCompletionMessageParam>> = {};

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Send thread content to ChatGPT
export async function sendThreadToChatGPT(
  chatId: string, 
  threadData: ThreadData
): Promise<string> {
  try {
    console.log(`Processing thread for chat ID: ${chatId}`);
    
    // Get existing messages or create a new array with system message
    if (!chatContexts[chatId]) {
      chatContexts[chatId] = [
        {
          role: 'system',
          content: 'You are a helpful assistant that receives content from Slack threads. Please respond based on the thread content provided.'
        }
      ];
      console.log(`Created new chat context for ID: ${chatId}`);
    }
    
    // Format the thread content
    const threadContent = formatThreadForChatGPT(threadData);
    
    // Add the new thread content as a user message
    chatContexts[chatId].push({
      role: 'user',
      content: `New Slack thread content:\n\n${threadContent}`
    });
    
    console.log(`Sending request to OpenAI with ${chatContexts[chatId].length} messages`);
    
    // Send to OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',  // or whichever model you prefer
      messages: chatContexts[chatId],
      max_tokens: 2000
    });
    
    // Get the assistant's response
    const response = completion.choices[0].message.content || 'No response from ChatGPT';
    
    // Add the assistant's response to the chat context
    chatContexts[chatId].push({
      role: 'assistant',
      content: response
    });
    
    console.log(`Added response to chat context. Total messages: ${chatContexts[chatId].length}`);
    
    return response;
  } catch (error) {
    console.error('Error sending thread to ChatGPT:', error);
    throw error;
  }
}