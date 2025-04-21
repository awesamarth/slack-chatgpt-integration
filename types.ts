export interface ThreadMessage {
    user: string;
    text: string;
    ts: string; // Timestamp
    username?: string;
  }
  
  export interface ThreadData {
    messages: ThreadMessage[];
    channelId: string;
    threadTs: string;
  }
  
  export interface SlackCommandPayload {
    command: string;
    text: string;
    response_url: string;
    trigger_id: string;
    user_id: string;
    user_name: string;
    team_id: string;
    channel_id: string;
    api_app_id: string;
    thread_ts?: string;
  }