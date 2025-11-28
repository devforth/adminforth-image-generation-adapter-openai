import type { AdapterOptions } from "./types.js";
import FormData from 'form-data';
import axios from 'axios';
import { fileTypeFromBuffer } from 'file-type';
import type { ImageGenerationAdapter } from "adminforth";


export default class ImageGenerationAdapterOpenAI implements ImageGenerationAdapter {
  options: AdapterOptions;

  constructor(options: AdapterOptions) {
    this.options = options;
    this.options.model = options.model || 'gpt-image-1';
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
    const { model = this.options.model || 'dall-e-2' } = this.options;
    const { prompt, inputFiles = [], size = this.outputDimensionsSupported()[0], n = 1 } = params;
    
    if (n > this.outputImagesMaxCountSupported()) {
      throw new Error(`For model "${model}", the maximum number of images is ${this.outputImagesMaxCountSupported()}`);
    }

    return await this.generateOrEditImage({ prompt, inputFiles, n, size });
  }


  stripLargeValuesInAnyObject(obj: any): any {
    if (typeof obj === 'string') {
      return obj.length > 100 ? obj.slice(0, 100) + '...' : obj;
    }
  
    if (Array.isArray(obj)) {
      return obj.map(item => this.stripLargeValuesInAnyObject(item));
    }
  
    if (obj && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [
          key,
          this.stripLargeValuesInAnyObject(value),
        ])
      );
    }
  
    return obj;
  }

  async guessMimeTypeByB64(b64: string): Promise<string> {
    // b64 is pure base64 string without data url prefix, so split will not work, we need to guess it
    const binaryData = Buffer.from(b64, 'base64');
    const fileType = await fileTypeFromBuffer(binaryData);

    return fileType?.mime || 'application/octet-stream'; // fallback if unknown
  }
  
  private async generateOrEditImage({
    prompt,
    inputFiles,
    n,
    size,
  }: {
    prompt: string;
    inputFiles: string[];
    n: number;
    size: string;
  }): Promise<{
    imageURLs?: string[];
    error?: string;
  }> {
    process.env.HEAVY_DEBUG && console.log('Generating image with prompt:', 
      this.stripLargeValuesInAnyObject(inputFiles), prompt, n, size);

    const headers = {
      Authorization: `Bearer ${this.options.openAiApiKey}`,
      'Content-Type': 'application/json',
    };

    const model = this.options.model;

    if (inputFiles.length === 0) {
      let response;
      try {
        response = await axios.post(
          'https://api.openai.com/v1/images/generations',
          { prompt, model, n, size, ...(this.options.extraParams || {}) },
          { headers }
        );
      } catch (error) {
        return { error: error.response.data.error.message };
      }
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

      if (this.options.extraParams) {
        for (const [key, value] of Object.entries(this.options.extraParams)) {
          formData.append(key, value);
        }
      }
        for (let i = 0; i < inputFiles.length; i++) {
          const fileUrl = inputFiles[i];
          if (fileUrl.startsWith('http')) {
            let responseImage;
            try {
              responseImage = await axios.get(fileUrl, { responseType: 'arraybuffer' });
            } catch (error) {
              console.error('Error fetching input file:', error);
              return { error: `Error attaching input files` };
            }
            const base64Data = Buffer.from(responseImage.data, 'binary').toString('base64');
            const buffer = Buffer.from(base64Data, 'base64');
            formData.append('image[]', buffer, { filename: `image_${i + 1}.png`, contentType: 'image/png' });
          } else if (fileUrl.startsWith('data:')) {
            const base64Data = fileUrl.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            formData.append('image[]', buffer, { filename: `image_${i + 1}.png`, contentType: 'image/png' });
          } else {
            throw new Error(`Unsupported file URL for attachment, it should be an absolute URL strating with http or a data URL, but got: ${fileUrl}`);
          }
        }
      const editHeaders = {
        Authorization: `Bearer ${this.options.openAiApiKey}`,
        ...formData.getHeaders(),
      };

      try {
        const editResponse = await axios.post(
          'https://api.openai.com/v1/images/edits',
          formData,
          { headers: editHeaders }
        );
        process.env.HEAVY_DEBUG && console.log('✏️ Edit response:', JSON.stringify( this.stripLargeValuesInAnyObject(editResponse.data)));
        return {
          imageURLs: await Promise.all(
            editResponse.data.data.map(async (image: any) => {
              const mimeTipe = await this.guessMimeTypeByB64(image.b64_json);
              return `data:${mimeTipe};base64,${image.b64_json}`
            }),
          ),
        }
      } catch (error) {
        console.error('Error generating image:', error.response);
        return { error: `Error generating image: ${error.message}` };
      }
      
    }
  }
}