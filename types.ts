export interface AdapterOptions {
  /**
   * OpenAI API key. Go to https://platform.openai.com/, go to Dashboard -> API keys -> Create new secret key
   * Paste value in your .env file OPENAI_API_KEY=your_key
   * Set openAiApiKey: process.env.OPENAI_API_KEY to access it
   */
  openAiApiKey: string;

  /**
   * Model name. Go to https://platform.openai.com/docs/models, select model and copy name.
   * Default is `dall-e-2`. Use e.g. more expensive `dall-e-3`  or `gpt-image-1` for more powerful model.
   */
  model?: string;

  /**
   * Extra parameters to be passed to the OpenAI API with every generation request.
   * Check here for params https://platform.openai.com/docs/api-reference/images
   */
  extraParams?: {
    [key: string]: any;
  };
  
}
