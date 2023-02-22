import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Grid } from '../entities/grid.entity';
import { FuturesController } from './futures.controller';
import { FuturesService } from './futures.service';
import { TaskService } from './futures.task';


@Module({
  imports: [TypeOrmModule.forFeature([Grid, User])],
  providers: [FuturesService, TaskService],
  controllers: [FuturesController],
})
export class FuturesModule { }
