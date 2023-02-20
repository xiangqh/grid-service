import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn, Unique } from 'typeorm';

// export type GridType ="SUBMITTING"|"COMPLETED";

export enum GridStatus {
  SUBMITTING = "SUBMITTING",
  COMPLETED = "COMPLETED",
  STOPED = "STOPED",
};

@Entity()
export class User {

  @PrimaryGeneratedColumn()
  id: number

  @Column({
    unique: true,
  })
  username: string

  @Column()
  password: string

  @Column()
  key: string

  @Column()
  secret: string

  @Column({
    unique: true,
    nullable: true,
  })
  sessionID: string

  @Column({
    nullable: true,
  })
  loginTime: Date
}