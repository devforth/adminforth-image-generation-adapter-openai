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
    this.options.n = options.n || 1;
  }

  validate() {
    if (!this.options.openAiApiKey) {
      throw new Error("API Key is required");
    }
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
    this.validate();

    const { prompt, inputFiles = [], n = this.options.n} = params;
    const { model } = this.options;

    const size = params.size || this.supportedDimensions()[0];

    if (model === 'dall-e-2' && n > 1) {
      throw new Error('For model "dall-e-2", only one image can be generated at a time');
    }

    return this.generateOrEditImage({ prompt, inputFiles, n, size });
  }

  outputImagesMaxCountSupported(): number {
    return this.options.model === 'gpt-image-1' ? 10 : 1;
  }

  supportedDimensions(): string[] {
    const supportedDimensions = {
      'gpt-image-1': ['1024x1024', '1024x1536', '1536x1024', 'auto'],
      'dall-e-2': []//todo
      // todo
    }
    
    return supportedDimensions[this.options.model];
  }

  // todo other methods


  stripLargeValuesInAnyObject(obj: any): any {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.stripLargeValuesInAnyObject(item));
    }
    const newObj: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const value = obj[key];
        if (typeof value === 'string' && value.length > 100) {
          newObj[key] = value.substring(0, 100) + '...';
        } else if (typeof value === 'object') {
          newObj[key] = this.stripLargeValuesInAnyObject(value);
        }
        else {
          newObj[key] = value;
        }
      }
    }
    return newObj;
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
    process.env.HEAVY_DEBUG && console.log('Generating image with prompt:', inputFiles, prompt, n, size);

    const headers = {
      Authorization: `Bearer ${this.options.openAiApiKey}`,
      'Content-Type': 'application/json',
    };

    const model = this.options.model;
    
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

      // todo if URL is already base64, don't need to fetch it
      for (let i = 0; i < inputFiles.length; i++) {
        const fileUrl = inputFiles[i];
        const responseImage = await axios.get(fileUrl, { responseType: 'arraybuffer' });
        const base64Data = Buffer.from(responseImage.data, 'binary').toString('base64');
        const buffer = Buffer.from(base64Data, 'base64');
        formData.append('image[]', buffer, { filename: `image_${i + 1}.png`, contentType: 'image/png' });
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
        return { error: `Error generating image: ${error.message}, ${JSON.stringify(error.response)}` };
      }
      
    }
  }
}