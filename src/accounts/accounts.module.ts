import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../entities/user.entity';
import { Grid } from '../entities/grid.entity';
import { AccountsController } from './accounts.controller';


@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AccountsController],
})
export class AccountsModule { }
