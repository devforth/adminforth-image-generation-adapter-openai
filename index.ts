import type { AdapterOptions } from "./types.js";
import FormData from 'form-data';
import axios from 'axios';

export class ImageGenerationAdapter {
  options: AdapterOptions;

  constructor(options: AdapterOptions) {
    this.options = options;
  }

  validate() {
    if (!this.options.openAiApiKey) {
      throw new Error("API Key is required");
    }
  }

  async generateImage(params: {
    prompt: string;
    inputFiles?: string[];
    size?: string;
  }) {
    this.validate();

    const { prompt, inputFiles = [], size = '1024x1024' } = params;
    const { model = this.options.model || 'gpt-image-1', n = this.options.n || 1 } = this.options;

    if (model === 'dall-e-2' && n > 1) {
      throw new Error('For model "dall-e-2", only one image can be generated at a time');
    }

    return this.generateOrEditImage({ prompt, inputFiles, model, n, size });
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
      return response.data;
    } else {
      const formData = new FormData();
      formData.append('prompt', prompt);
      formData.append('model', model);
      formData.append('n', n.toString());
      formData.append('size', size);

      if (model === 'dall-e-2') {
        const fileUrl = inputFiles[0];
        const responseImage = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const base64Data = Buffer.from(responseImage.data, 'binary').toString('base64');
        const buffer = Buffer.from(base64Data, 'base64');
        formData.append('image', buffer, { filename: 'image.png', contentType: 'image/png' });
      } else if (model === 'gpt-image-1') {
        for (let i = 0; i < inputFiles.length; i++) {
          const fileUrl = inputFiles[i];
          const responseImage = await axios.get(fileUrl, { responseType: 'arraybuffer' });
          const base64Data = Buffer.from(responseImage.data, 'binary').toString('base64');
          const buffer = Buffer.from(base64Data, 'base64');
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