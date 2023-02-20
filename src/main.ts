import { NestFactory } from '@nestjs/core';
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({credentials:true, origin:true});
  app.use(cookieParser());

  const configService = app.get(ConfigService);
  await app.listen(configService.get("port", "3000"));
  console.log(`app start port ${configService.get("port", "3000")}`, );
}
bootstrap();
