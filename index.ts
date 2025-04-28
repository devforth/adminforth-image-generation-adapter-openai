import type { AdapterOptions } from "./types.js";
import FormData from 'form-data';
import axios from 'axios';
import type { ImageGenerationAdapter } from "adminforth";

export default class ImageGenerationAdapterOpenAI implements ImageGenerationAdapter {
  options: AdapterOptions;

  constructor(options: AdapterOptions) {
    this.options = options;
  }

  validate() {
    if (!this.options.openAiApiKey) {
      throw new Error("API Key is required");
    }
  }

  outputImagesMaxCountSupported(): number {
    if (this.options.model === 'gpt-image-1' || this.options.model === 'dall-e-2') {
      return 10;
    } else if (this.options.model === 'dall-e-3') {
      return 1;
    }
  }
  
  outputDimensionsSupported(): string[] {
    if (this.options.model === 'gpt-image-1') {
      return ['1024x1024', '1536x1024', '1024x1536', 'auto'];
    } else if (this.options.model === 'dall-e-2') {
      return ['256x256', '512x512', '1024x1024'];
    } else if (this.options.model === 'dall-e-3') {
      return ['1024x1024', '1792x1024', '1024x1792'];
    }
  }

  inputFileExtensionSupported(): string[] {
    if (this.options.model === 'dall-e-2') {
      return ['png'];
    } else if (this.options.model === 'gpt-image-1' || this.options.model === 'dall-e-3') {
      return ['png', 'jpg', 'jpeg'];
    }
    return [];
  }

  async generate(params: {
    prompt: string;
    inputFiles?: string[];
    size?: string;
    n?: number;
  }): Promise<{
    imageURLs?: string[];
    error?: string;
  }> {
    try {
      this.validate();

      const { model = this.options.model || 'dall-e-2' } = this.options;
      const { prompt, inputFiles = [], size = this.outputDimensionsSupported()[0], n = 1 } = params;
      
      if (model === 'dall-e-2' && n > 1) {
        throw new Error('For model "dall-e-2", only one image can be generated at a time');
      }

      const data = await this.generateOrEditImage({ prompt, inputFiles, model, n, size });

      if (!data.data || !Array.isArray(data.data)) {
        return { error: 'No images data returned' };
      }
  
      const imageURLs = data.data.map((item: any) => {
        if (item.url) {
          return item.url;
        }
        if (item.b64_json) {
          return `data:image/png;base64,${item.b64_json}`;
        }
        return null;
      }).filter((url: string | null) => url !== null);
  
      if (imageURLs.length === 0) {
        return { error: 'No valid image URLs returned' };
      }
  
      return { imageURLs };
    } catch (err: any) {
      return { error: err.message || 'Unknown error' };
    }
  }

  private async generateOrEditImage({
    prompt,
    inputFiles,
    model,
    n,
    size,
  }: {
    prompt: string;
    inputFiles: string[];
    model: string;
    n: number;
    size: string;
  }) {
    const headers = {
      Authorization: `Bearer ${this.options.openAiApiKey}`,
      'Content-Type': 'application/json',
    };

    if (inputFiles.length === 0) {
      const response = await axios.post(
        'https://api.openai.com/v1/images/generations',
        { prompt, model, n, size },
        { headers }
      );
  
      const images = response.data?.data ?? [];
      const imageURLs = images.map((item: any) => {
        if (item.url) {
          return item.url;
        }
        if (item.b64_json) {
          return `data:image/png;base64,${item.b64_json}`;
        }
        return null;
      }).filter((url: string | null) => url !== null);
  
      return { imageURLs };
    } else {
      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('model', model);
      formData.append('n', n.toString());
      formData.append('size', size);

      if (model === 'dall-e-2') {
        const fileUrl = inputFiles[0];
        const responseImage = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(responseImage.data, 'binary');
        formData.append('image', buffer, { filename: 'image.png', contentType: 'image/png' });
      } else if (model === 'gpt-image-1') {
        for (let i = 0; i < inputFiles.length; i++) {
          const fileUrl = inputFiles[i];
          const responseImage = await axios.get(fileUrl, { responseType: 'arraybuffer' });
          const buffer = Buffer.from(responseImage.data, 'binary');
          formData.append('image[]', buffer, { filename: `image_${i + 1}.png`, contentType: 'image/png' });
        }
      }

      const editHeaders = {
        Authorization: `Bearer ${this.options.openAiApiKey}`,
        ...formData.getHeaders(),
      };

      const editResponse = await axios.post(
        'https://api.openai.com/v1/images/edits',
        formData,
        { headers: editHeaders }
      );
      return editResponse.data;
    }
  }
}