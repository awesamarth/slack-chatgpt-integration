import OpenAI from 'openai';
import { kv } from '@vercel/kv';
import { ThreadData } from './types';
import { formatThreadForChatGPT } from './utils';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Store conversation context
async function storeConversationContext(chatId: string, messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<void> {
    await kv.set(`openai:${chatId}`, messages); // No expiration

}

// Get conversation context
async function getConversationContext(chatId: string): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  const messages = await kv.get<OpenAI.Chat.ChatCompletionMessageParam[]>(`openai:${chatId}`);
  
  if (!messages) {
    // Return default system message if no context exists
    return [
      {
        role: 'system',
        content: 'You are a helpful assistant that receives content from Slack threads. Please respond based on the thread content provided.'
      }
    ];
  }
  
  return messages;
}

// Send thread content to ChatGPT
export async function sendThreadToChatGPT(
  chatId: string, 
  threadData: ThreadData
): Promise<string> {
  try {
    // Get existing conversation context
    const messages = await getConversationContext(chatId);
    
    // Format the thread content and add as a user message
    const threadContent = formatThreadForChatGPT(threadData);
    messages.push({
      role: 'user',
      content: `New Slack thread content:\n\n${threadContent}`
    });
    
    // Send to OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',  // or whichever model you prefer
      messages,
      max_tokens: 2000
    });
    
    // Get the assistant's response
    const response = completion.choices[0].message.content || 'No response from ChatGPT';
    
    // Update conversation history with assistant's response
    messages.push({
      role: 'assistant',
      content: response
    });
    
    // Store updated conversation
    await storeConversationContext(chatId, messages);
    
    return response;
  } catch (error) {
    console.error('Error sending thread to ChatGPT:', error);
    throw error;
  }
}